import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export type VkCallbackConfig = { groupId: number; secret: string; confirmationCode?: string };
type VkCallbackEvent = { type: string; group_id: number; event_id: string; v: string; secret: string; object?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCallbackEvent(value: unknown): value is VkCallbackEvent {
  return isRecord(value)
    && typeof value.type === 'string'
    && Number.isSafeInteger(value.group_id) && Number(value.group_id) > 0
    && typeof value.event_id === 'string' && value.event_id.length > 0 && value.event_id.length <= 128
    && typeof value.v === 'string' && value.v.length > 0 && value.v.length <= 20
    && typeof value.secret === 'string';
}

function matchesSecret(received: string, expected: string): boolean {
  const actualBytes = Buffer.from(received, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function registerVkCallbackRoutes(app: FastifyInstance, pool: Pool, config: VkCallbackConfig): void {
  app.post<{ Body: unknown }>('/api/vk/callback', async (request, reply) => {
    const body: unknown = request.body;
    if (isRecord(body) && body.type === 'confirmation') {
      if (!Number.isSafeInteger(body.group_id) || Number(body.group_id) < 1) {
        return reply.code(400).send({ error: 'invalid_callback' });
      }
      if (Number(body.group_id) !== config.groupId) return reply.code(403).send({ error: 'invalid_callback_credentials' });
      if (body.secret !== undefined && (typeof body.secret !== 'string' || !matchesSecret(body.secret, config.secret))) {
        return reply.code(403).send({ error: 'invalid_callback_credentials' });
      }
      if (!config.confirmationCode?.trim()) return reply.code(503).send({ error: 'callback_confirmation_not_configured' });
      return reply.type('text/plain').send(config.confirmationCode);
    }
    if (!validCallbackEvent(body)) return reply.code(400).send({ error: 'invalid_callback' });
    if (body.group_id !== config.groupId || !matchesSecret(body.secret, config.secret)) {
      return reply.code(403).send({ error: 'invalid_callback_credentials' });
    }
    if (!['message_allow', 'message_deny'].includes(body.type)) return reply.type('text/plain').send('ok');
    if (!isRecord(body.object) || !Number.isSafeInteger(body.object.user_id) || Number(body.object.user_id) < 1) {
      return reply.code(400).send({ error: 'invalid_callback_event' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO vk_callback_events (event_id, event_type, group_id) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
        [body.event_id, body.type, config.groupId],
      );
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return reply.type('text/plain').send('ok');
      }
      const status = body.type === 'message_allow' ? 'allowed' : 'denied';
      await client.query(
        `INSERT INTO resident_message_permissions (resident_id, status, consented_at, updated_at)
         SELECT id, $2, CASE WHEN $2 = 'allowed' THEN now() ELSE NULL END, now()
           FROM residents WHERE vk_user_id = $1
         ON CONFLICT (resident_id) DO UPDATE
           SET status = CASE WHEN resident_message_permissions.status = 'opted_out' THEN 'opted_out' ELSE EXCLUDED.status END,
               consented_at = CASE WHEN EXCLUDED.status = 'allowed' AND resident_message_permissions.status <> 'opted_out' THEN now() ELSE resident_message_permissions.consented_at END,
               updated_at = now()`,
        [String(body.object.user_id), status],
      );
      if (status === 'denied') {
        await client.query(
          `UPDATE vk_notification_outbox SET status = 'denied', locked_at = NULL, last_error_code = 'permission_revoked'
            WHERE resident_id = (SELECT id FROM residents WHERE vk_user_id = $1)
              AND status IN ('pending', 'processing')`,
          [String(body.object.user_id)],
        );
      }
      await client.query('COMMIT');
      return reply.type('text/plain').send('ok');
    } catch {
      await client.query('ROLLBACK');
      return reply.code(500).send({ error: 'callback_processing_failed' });
    } finally {
      client.release();
    }
  });
}
