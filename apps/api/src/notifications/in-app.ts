import type { PoolClient } from 'pg';

// Уведомления о Заявках и Авариях — только в мини-аппе (docs/adr/0012): бот не
// пишет людям, которые с ним не разговаривали. Пишутся в той же транзакции,
// что и изменение, поэтому не теряются и не приходят о несостоявшемся.

export type InAppNotification = {
  kind: 'request-new' | 'request-status' | 'request-comment' | 'request-visit' | 'accident' | 'management-question' | 'management-answer';
  houseId: string;
  title: string;
  body?: string;
  requestId?: string;
  accidentId?: string;
  managementQuestionId?: string;
  managementQuestionMessageId?: string;
};

/** Уведомить людей; повторы и того, кто сам сделал изменение, отбрасываем. */
export async function notifyResidents(
  client: PoolClient,
  residentIds: Iterable<string>,
  notification: InAppNotification,
  exceptResidentId?: string | null,
): Promise<void> {
  const recipients = [...new Set(residentIds)].filter((id) => id !== exceptResidentId);
  if (recipients.length === 0) return;
  await client.query(
    `INSERT INTO in_app_notifications
       (resident_id, house_id, kind, title, body, request_id, accident_id, management_question_id, management_question_message_id)
     SELECT recipient, $2, $3, $4, $5, $6, $7, $8, $9 FROM unnest($1::uuid[]) AS recipient`,
    [
      recipients,
      notification.houseId,
      notification.kind,
      notification.title.slice(0, 200),
      notification.body ? notification.body.slice(0, 1000) : null,
      notification.requestId ?? null,
      notification.accidentId ?? null,
      notification.managementQuestionId ?? null,
      notification.managementQuestionMessageId ?? null,
    ],
  );
}

/** УК и Администраторы Дома — те, кто обрабатывает Заявки. */
export async function processorIds(client: PoolClient, houseId: string): Promise<string[]> {
  const result = await client.query<{ resident_id: string }>(
    `SELECT resident_id FROM memberships
      WHERE house_id = $1 AND ended_at IS NULL AND role IN ('admin', 'management-company')`,
    [houseId],
  );
  return result.rows.map((row) => row.resident_id);
}

/** Отметившие «У меня тоже» на Заявке. */
export async function supporterIds(client: PoolClient, requestId: string): Promise<string[]> {
  const result = await client.query<{ resident_id: string }>(
    'SELECT resident_id FROM request_supporters WHERE request_id = $1',
    [requestId],
  );
  return result.rows.map((row) => row.resident_id);
}
