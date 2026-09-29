import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { UserNotification } from '@maxtown/shared';
import { requireAuthentication } from '../auth/sessions.ts';

type NotificationRow = { id: string; house_id: string; house_address: string; poll_id: string; question: string; created_at: Date; read_at: Date | null };

export function registerNotificationRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);
  app.get('/api/notifications', { preHandler: authenticated }, async (request): Promise<{ notifications: UserNotification[] }> => {
    const residentId = request.authSession!.resident.id;
    const result = await pool.query<NotificationRow>(
      `SELECT notification.id, notification.house_id, house.address AS house_address, notification.poll_id, poll.question,
              notification.created_at, notification.read_at
         FROM in_app_notifications notification
         JOIN polls poll ON poll.id = notification.poll_id AND poll.house_id = notification.house_id
         JOIN houses house ON house.id = notification.house_id
        WHERE notification.resident_id = $1
          AND EXISTS (SELECT 1 FROM memberships membership WHERE membership.resident_id = $1
                       AND membership.house_id = notification.house_id AND membership.ended_at IS NULL)
        ORDER BY notification.created_at DESC, notification.id DESC LIMIT 100`,
      [residentId],
    );
    return { notifications: result.rows.map((row) => ({
      id: row.id, kind: 'community-poll', title: `Новый Опрос · ${row.house_address}`, text: row.question,
      at: row.created_at.toISOString(), read: row.read_at !== null, houseId: row.house_id, pollId: row.poll_id,
    })) };
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
