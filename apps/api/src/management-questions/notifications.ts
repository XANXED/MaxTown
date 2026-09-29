import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

type Recipient = {
  residentId: string | null;
  maxUserId: string | null;
};

type QuestionEvent = {
  houseId: string;
  questionId: string;
  messageId: string;
  title: string;
  body: string;
  eventKind: 'question' | 'follow-up' | 'answer' | 'catch-up';
  notificationKind: 'management-question' | 'management-answer';
};

function validMaxUserId(value: string | null): value is string {
  return value !== null && /^[1-9][0-9]*$/.test(value);
}

async function enqueue(client: Db, recipient: Recipient, event: QuestionEvent): Promise<void> {
  if (recipient.residentId) {
    await client.query(
      `INSERT INTO in_app_notifications
         (resident_id, house_id, kind, title, body, management_question_id, management_question_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (resident_id, kind, management_question_message_id)
         WHERE management_question_message_id IS NOT NULL DO NOTHING`,
      [recipient.residentId, event.houseId, event.notificationKind, event.title.slice(0, 200), event.body.slice(0, 1000), event.questionId, event.messageId],
    );
  }
  if (validMaxUserId(recipient.maxUserId)) {
    const audience = event.notificationKind === 'management-answer' ? 'author' : 'management';
    await client.query(
      `INSERT INTO max_direct_message_outbox
         (house_id, management_question_id, management_question_message_id, resident_id, max_user_id,
          event_kind, message, button_text, button_payload, dedupe_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::text::bigint, $6, $7, 'Открыть вопрос',
               'question_' || $1::uuid::text || '_' || $2::uuid::text,
               'question:' || $3::uuid::text || ':' || $8 || ':' || $5::text)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [event.houseId, event.questionId, event.messageId, recipient.residentId, recipient.maxUserId,
        event.eventKind, `${event.title}. ${event.body}`.slice(0, 4000), audience],
    );
  }
}

async function managementRecipients(client: PoolClient, houseId: string): Promise<Recipient[]> {
  const result = await client.query<{ resident_id: string | null; max_user_id: string | null }>(
    `SELECT DISTINCT recipient.resident_id, recipient.max_user_id
       FROM (
         SELECT membership.resident_id, resident.max_user_id
           FROM memberships membership
           JOIN residents resident ON resident.id = membership.resident_id
          WHERE membership.house_id = $1 AND membership.ended_at IS NULL
            AND membership.role = 'management-company'
         UNION
         SELECT resident.id, chat.management_company_max_user_id::text
           FROM house_chats chat
           LEFT JOIN residents resident
             ON resident.max_user_id = chat.management_company_max_user_id::text
          WHERE chat.house_id = $1 AND chat.disconnected_at IS NULL
            AND chat.management_company_max_user_id IS NOT NULL
       ) recipient`,
    [houseId],
  );
  return result.rows.map((row) => ({ residentId: row.resident_id, maxUserId: row.max_user_id }));
}

export async function notifyManagement(client: PoolClient, event: Omit<QuestionEvent, 'notificationKind'>): Promise<void> {
  for (const recipient of await managementRecipients(client, event.houseId)) {
    await enqueue(client, recipient, { ...event, notificationKind: 'management-question' });
  }
}

export async function notifyQuestionAuthor(
  client: PoolClient,
  authorResidentId: string,
  event: Omit<QuestionEvent, 'notificationKind'>,
): Promise<void> {
  const result = await client.query<{ resident_id: string; max_user_id: string | null }>(
    'SELECT id AS resident_id, max_user_id FROM residents WHERE id = $1',
    [authorResidentId],
  );
  const recipient = result.rows[0];
  if (recipient) {
    await enqueue(client, { residentId: recipient.resident_id, maxUserId: recipient.max_user_id }, { ...event, notificationKind: 'management-answer' });
  }
}

/**
 * Доставить новой УК каждый ожидающий вопрос. Вызывается и при назначении,
 * и при первом входе: уникальные ключи не дают создать повторы.
 */
export async function enqueueWaitingQuestionsForManagement(
  db: Db,
  houseId: string,
  maxUserId: number,
  residentId: string | null,
): Promise<void> {
  const questions = await db.query<{
    id: string; title: string; message_id: string; body: string; author_name: string;
  }>(
    `SELECT question.id, question.title, latest.id AS message_id, latest.body, author.display_name AS author_name
       FROM management_questions question
       JOIN residents author ON author.id = question.author_resident_id
       JOIN LATERAL (
         SELECT message.id, message.body
           FROM management_question_messages message
          WHERE message.question_id = question.id AND message.author_role <> 'management-company'
          ORDER BY message.seq DESC LIMIT 1
       ) latest ON true
      WHERE question.house_id = $1 AND question.state = 'waiting-for-answer'
      ORDER BY question.updated_at, question.id`,
    [houseId],
  );
  for (const question of questions.rows) {
    await enqueue(db, { residentId, maxUserId: String(maxUserId) }, {
      houseId,
      questionId: question.id,
      messageId: question.message_id,
      title: `Вопрос в УК: ${question.title}`,
      body: `${question.author_name}: ${question.body}`,
      eventKind: 'catch-up',
      notificationKind: 'management-question',
    });
  }
}
