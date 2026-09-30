import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { UserNotification } from '@maxtown/shared';
import { requireAuthentication } from '../auth/sessions.ts';

type NotificationRow = {
  id: string;
  kind: UserNotification['kind'];
  house_id: string;
  house_address: string;
  poll_id: string | null;
  question: string | null;
  request_id: string | null;
  accident_id: string | null;
  apartment_repair_id: string | null;
  management_question_id: string | null;
  utility_payment_period_id: string | null;
  apartment_access_request_id: string | null;
  title: string | null;
  body: string | null;
  created_at: Date;
  read_at: Date | null;
};

function toNotification(row: NotificationRow): UserNotification {
  const base = { id: row.id, at: row.created_at.toISOString(), read: row.read_at !== null, houseId: row.house_id };
  if (row.kind === 'community-poll') {
    return {
      ...base, kind: 'community-poll', title: `Новый Опрос · ${row.house_address}`,
      ...(row.question ? { text: row.question } : {}), ...(row.poll_id ? { pollId: row.poll_id } : {}),
    };
  }
  return {
    ...base,
    kind: row.kind,
    title: row.title ?? '',
    ...(row.body ? { text: row.body } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.accident_id ? { eventId: row.accident_id } : {}),
    ...(row.apartment_repair_id ? { repairId: row.apartment_repair_id } : {}),
    ...(row.management_question_id ? { managementQuestionId: row.management_question_id } : {}),
    ...(row.utility_payment_period_id ? { utilityPaymentPeriodId: row.utility_payment_period_id } : {}),
    ...(row.apartment_access_request_id ? { apartmentAccessRequestId: row.apartment_access_request_id } : {}),
  };
}

export function registerNotificationRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);
  app.get('/api/notifications', { preHandler: authenticated }, async (request): Promise<{ notifications: UserNotification[] }> => {
    const residentId = request.authSession!.resident.id;
    const result = await pool.query<NotificationRow>(
      `SELECT notification.id, notification.kind, notification.house_id, house.address AS house_address,
              notification.poll_id, poll.question, notification.request_id, notification.accident_id,
              notification.apartment_repair_id,
              notification.management_question_id,
              notification.utility_payment_period_id,
              notification.apartment_access_request_id,
              notification.title, notification.body, notification.created_at, notification.read_at
         FROM in_app_notifications notification
         JOIN houses house ON house.id = notification.house_id
         LEFT JOIN polls poll ON poll.id = notification.poll_id AND poll.house_id = notification.house_id
         LEFT JOIN utility_payment_periods utility_period
           ON utility_period.id = notification.utility_payment_period_id AND utility_period.house_id = notification.house_id
        WHERE notification.resident_id = $1
          AND EXISTS (SELECT 1 FROM memberships membership WHERE membership.resident_id = $1
                       AND membership.house_id = notification.house_id AND membership.ended_at IS NULL
                       AND (notification.kind <> 'utility-payment'
                         OR membership.apartment_household_id = utility_period.apartment_household_id))
        ORDER BY notification.created_at DESC, notification.id DESC LIMIT 100`,
      [residentId],
    );
    return { notifications: result.rows.map(toNotification) };
  });

  app.patch<{ Params: { notificationId: string } }>('/api/notifications/:notificationId/read', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['notificationId'], properties: { notificationId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const result = await pool.query(
      'UPDATE in_app_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND resident_id = $2 RETURNING id',
      [request.params.notificationId, request.authSession!.resident.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'notification_not_found' });
    return { status: 'read' as const };
  });

  app.patch('/api/notifications/read-all', { preHandler: authenticated }, async (request) => {
    await pool.query('UPDATE in_app_notifications SET read_at = now() WHERE resident_id = $1 AND read_at IS NULL', [request.authSession!.resident.id]);
    return { status: 'read' as const };
  });
}
