import type { Pool, PoolClient } from 'pg';
import type {
  HouseRole,
  ManagementQuestion,
  ManagementQuestionInput,
  ManagementQuestionMessageInput,
  ManagementQuestionState,
  ManagementQuestionSummary,
} from '@maxtown/shared';
import { detectImageType, PHOTO_LIMIT, PHOTO_MAX_BYTES } from '../requests/store.ts';
import { notifyManagement, notifyQuestionAuthor } from './notifications.ts';

type Db = Pool | PoolClient;

export type ManagementQuestionContext = {
  houseId: string;
  membershipId: string;
  residentId: string;
  residentName: string;
  role: HouseRole;
};

type QuestionRow = {
  id: string;
  house_id: string;
  author_resident_id: string;
  author_name: string;
  title: string;
  state: ManagementQuestionState;
  created_at: Date;
  updated_at: Date;
};

export class ManagementQuestionProblem extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const questionSelect = `SELECT question.id, question.house_id, question.author_resident_id,
  author.display_name AS author_name, question.title, question.state,
  question.created_at, question.updated_at
  FROM management_questions question
  JOIN residents author ON author.id = question.author_resident_id`;

function summary(row: QuestionRow): ManagementQuestionSummary {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    authorName: row.author_name,
    updatedAt: row.updated_at.toISOString(),
  };
}

function cleanText(value: string, max: number, code: string): string {
  const text = value.trim();
  if (!text || text.length > max) throw new ManagementQuestionProblem(400, code);
  return text;
}

async function findQuestion(db: Db, context: ManagementQuestionContext, questionId: string, lock = false): Promise<QuestionRow | null> {
  const result = await db.query<QuestionRow>(
    `${questionSelect} WHERE question.house_id = $1 AND question.id = $2${lock ? ' FOR UPDATE OF question' : ''}`,
    [context.houseId, questionId],
  );
  return result.rows[0] ?? null;
}

async function requireQuestion(db: Db, context: ManagementQuestionContext, questionId: string, lock = false): Promise<QuestionRow> {
  const row = await findQuestion(db, context, questionId, lock);
  if (!row) throw new ManagementQuestionProblem(404, 'management_question_not_found');
  return row;
}

export async function managementAssigned(db: Db, houseId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       WHERE EXISTS (SELECT 1 FROM memberships WHERE house_id = $1 AND ended_at IS NULL AND role = 'management-company')
          OR EXISTS (SELECT 1 FROM house_chats WHERE house_id = $1 AND disconnected_at IS NULL
                     AND management_company_max_user_id IS NOT NULL)`,
    [houseId],
  );
  return Boolean(result.rowCount);
}

export async function listManagementQuestions(db: Db, context: ManagementQuestionContext): Promise<ManagementQuestionSummary[]> {
  const result = await db.query<QuestionRow>(
    `${questionSelect} WHERE question.house_id = $1
      ORDER BY CASE question.state WHEN 'waiting-for-answer' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
               question.updated_at DESC, question.id DESC
      LIMIT 200`,
    [context.houseId],
  );
  return result.rows.map(summary);
}

export async function readManagementQuestion(db: Db, context: ManagementQuestionContext, questionId: string): Promise<ManagementQuestion | null> {
  const row = await findQuestion(db, context, questionId);
  if (!row) return null;
  const messages = await db.query<{
    id: string; author_resident_id: string; author_name: string; author_role: HouseRole; body: string; created_at: Date;
  }>(
    `SELECT message.id, message.author_resident_id, author.display_name AS author_name,
            message.author_role, message.body, message.created_at
       FROM management_question_messages message
       JOIN residents author ON author.id = message.author_resident_id
      WHERE message.question_id = $1 ORDER BY message.seq`,
    [row.id],
  );
  const photos = await db.query<{ id: string; message_id: string }>(
    'SELECT id, message_id FROM management_question_photos WHERE question_id = $1 ORDER BY message_id, position',
    [row.id],
  );
  const byMessage = new Map<string, Array<{ id: string; url: string }>>();
  for (const photo of photos.rows) {
    const list = byMessage.get(photo.message_id) ?? [];
    list.push({ id: photo.id, url: `/api/houses/${context.houseId}/management-questions/${row.id}/messages/${photo.message_id}/photos/${photo.id}` });
    byMessage.set(photo.message_id, list);
  }
  const history = await db.query<{ state: ManagementQuestionState; created_at: Date }>(
    'SELECT state, created_at FROM management_question_state_changes WHERE question_id = $1 ORDER BY id',
    [row.id],
  );
  const mine = row.author_resident_id === context.residentId;
  return {
    ...summary(row),
    messages: messages.rows.map((message) => ({
      id: message.id,
      authorName: message.author_name,
      authorRole: message.author_role,
      mine: message.author_resident_id === context.residentId,
      text: message.body,
      photos: byMessage.get(message.id) ?? [],
      at: message.created_at.toISOString(),
    })),
    history: history.rows.map((change) => ({ state: change.state, at: change.created_at.toISOString() })),
    canWrite: row.state !== 'closed' && (mine || context.role === 'management-company'),
    canClose: row.state !== 'closed' && mine,
    canReopen: row.state === 'closed' && mine,
  };
}

async function insertMessage(
  client: PoolClient,
  context: ManagementQuestionContext,
  questionId: string,
  text: string,
  role: HouseRole,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO management_question_messages (question_id, author_resident_id, author_role, body)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [questionId, context.residentId, role, cleanText(text, 4000, 'management_question_text_invalid')],
  );
  return result.rows[0]!.id;
}

async function setState(client: PoolClient, row: QuestionRow, context: ManagementQuestionContext, state: ManagementQuestionState): Promise<void> {
  await client.query(
    `UPDATE management_questions
        SET state = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1`,
    [row.id, state],
  );
  await client.query(
    'INSERT INTO management_question_state_changes (question_id, state, actor_resident_id) VALUES ($1, $2, $3)',
    [row.id, state, context.residentId],
  );
}

export async function createManagementQuestion(
  client: PoolClient,
  context: ManagementQuestionContext,
  input: ManagementQuestionInput,
): Promise<string> {
  if (context.role === 'management-company') throw new ManagementQuestionProblem(403, 'management_question_create_forbidden');
  const title = cleanText(input.title, 120, 'management_question_title_invalid');
  const question = await client.query<{ id: string }>(
    `INSERT INTO management_questions (house_id, author_resident_id, title)
     VALUES ($1, $2, $3) RETURNING id`,
    [context.houseId, context.residentId, title],
  );
  const id = question.rows[0]!.id;
  const messageId = await insertMessage(client, context, id, input.text, context.role);
  await client.query(
    `INSERT INTO management_question_state_changes (question_id, state, actor_resident_id)
     VALUES ($1, 'waiting-for-answer', $2)`,
    [id, context.residentId],
  );
  await notifyManagement(client, {
    houseId: context.houseId, questionId: id, messageId, title: `Вопрос в УК: ${title}`,
    body: `${context.residentName}: ${cleanText(input.text, 4000, 'management_question_text_invalid')}`,
    eventKind: 'question',
  });
  return id;
}

export async function addManagementQuestionMessage(
  client: PoolClient,
  context: ManagementQuestionContext,
  questionId: string,
  input: ManagementQuestionMessageInput,
): Promise<string> {
  const row = await requireQuestion(client, context, questionId, true);
  if (row.state === 'closed') throw new ManagementQuestionProblem(409, 'management_question_closed');
  const author = row.author_resident_id === context.residentId;
  if (!author && context.role !== 'management-company') throw new ManagementQuestionProblem(403, 'management_question_write_forbidden');
  const role: HouseRole = author ? (context.role === 'admin' ? 'admin' : 'resident') : 'management-company';
  const messageId = await insertMessage(client, context, row.id, input.text, role);
  const nextState: ManagementQuestionState = author ? 'waiting-for-answer' : 'answered';
  await setState(client, row, context, nextState);
  if (author) {
    await notifyManagement(client, {
      houseId: row.house_id, questionId: row.id, messageId, title: `Уточнение к вопросу: ${row.title}`,
      body: `${context.residentName}: ${cleanText(input.text, 4000, 'management_question_text_invalid')}`,
      eventKind: 'follow-up',
    });
  } else {
    await notifyQuestionAuthor(client, row.author_resident_id, {
      houseId: row.house_id, questionId: row.id, messageId, title: `УК ответила: ${row.title}`,
      body: cleanText(input.text, 4000, 'management_question_text_invalid'), eventKind: 'answer',
    });
  }
  return messageId;
}

export async function closeManagementQuestion(client: PoolClient, context: ManagementQuestionContext, questionId: string): Promise<void> {
  const row = await requireQuestion(client, context, questionId, true);
  if (row.author_resident_id !== context.residentId) throw new ManagementQuestionProblem(403, 'management_question_close_forbidden');
  if (row.state === 'closed') throw new ManagementQuestionProblem(409, 'management_question_closed');
  await setState(client, row, context, 'closed');
}

export async function reopenManagementQuestion(
  client: PoolClient,
  context: ManagementQuestionContext,
  questionId: string,
  input: ManagementQuestionMessageInput,
): Promise<string> {
  const row = await requireQuestion(client, context, questionId, true);
  if (row.author_resident_id !== context.residentId) throw new ManagementQuestionProblem(403, 'management_question_reopen_forbidden');
  if (row.state !== 'closed') throw new ManagementQuestionProblem(409, 'management_question_not_closed');
  const role: HouseRole = context.role === 'admin' ? 'admin' : 'resident';
  const messageId = await insertMessage(client, context, row.id, input.text, role);
  await setState(client, row, context, 'waiting-for-answer');
  await notifyManagement(client, {
    houseId: row.house_id, questionId: row.id, messageId, title: `Вопрос возобновлён: ${row.title}`,
    body: `${context.residentName}: ${cleanText(input.text, 4000, 'management_question_text_invalid')}`,
    eventKind: 'follow-up',
  });
  return messageId;
}

export async function addManagementQuestionPhoto(
  client: PoolClient,
  context: ManagementQuestionContext,
  questionId: string,
  messageId: string,
  data: Buffer,
): Promise<string> {
  const row = await requireQuestion(client, context, questionId, true);
  if (row.state === 'closed') throw new ManagementQuestionProblem(409, 'management_question_closed');
  const message = await client.query<{ author_resident_id: string }>(
    'SELECT author_resident_id FROM management_question_messages WHERE id = $1 AND question_id = $2',
    [messageId, row.id],
  );
  if (!message.rows[0]) throw new ManagementQuestionProblem(404, 'management_question_message_not_found');
  if (message.rows[0].author_resident_id !== context.residentId) throw new ManagementQuestionProblem(403, 'management_question_photo_forbidden');
  const contentType = detectImageType(data);
  if (!contentType) throw new ManagementQuestionProblem(415, 'unsupported_photo');
  if (data.length > PHOTO_MAX_BYTES) throw new ManagementQuestionProblem(413, 'photo_too_large');
  const existing = await client.query<{ count: number; position: number }>(
    `SELECT count(*)::int AS count, coalesce(max(position), 0)::int AS position
       FROM management_question_photos WHERE message_id = $1`,
    [messageId],
  );
  if (existing.rows[0]!.count >= PHOTO_LIMIT) throw new ManagementQuestionProblem(409, 'photo_limit_reached');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO management_question_photos (question_id, message_id, position, content_type, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [row.id, messageId, existing.rows[0]!.position + 1, contentType, data],
  );
  return inserted.rows[0]!.id;
}

export async function readManagementQuestionPhoto(
  db: Db,
  context: ManagementQuestionContext,
  questionId: string,
  messageId: string,
  photoId: string,
): Promise<{ contentType: string; data: Buffer } | null> {
  if (!(await findQuestion(db, context, questionId))) return null;
  const result = await db.query<{ content_type: string; data: Buffer }>(
    `SELECT content_type, data FROM management_question_photos
      WHERE question_id = $1 AND message_id = $2 AND id = $3`,
    [questionId, messageId, photoId],
  );
  const photo = result.rows[0];
  return photo ? { contentType: photo.content_type, data: photo.data } : null;
}
