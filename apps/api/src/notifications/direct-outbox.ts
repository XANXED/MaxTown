import type { Pool } from 'pg';
import { MaxApiError, type MaxOpenAppButton } from '../max/api.ts';
import { retryDelayMs } from './outbox.ts';

export type DirectMessageDelivery = {
  id: string;
  userId: number;
  message: string;
  buttonText: string;
  buttonPayload: string;
  attempt: number;
};

export type DirectMessageOutboxStore = {
  claim(limit: number): Promise<DirectMessageDelivery[]>;
  markSent(id: string): Promise<void>;
  retry(id: string, delayMs: number, error: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
};

export type DirectMessageSender = {
  sendUserMessage(userId: number, text: string, button?: MaxOpenAppButton): Promise<void>;
};

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 50;
const CLAIM_LEASE = '5 minutes';

export async function flushDirectMessageOutbox(
  store: DirectMessageOutboxStore,
  sender: DirectMessageSender,
  limit = 20,
): Promise<void> {
  const deliveries = await store.claim(Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(limit))));
  for (const delivery of deliveries) {
    try {
      await sender.sendUserMessage(
        delivery.userId,
        delivery.message,
        { text: delivery.buttonText, payload: delivery.buttonPayload },
      );
      await store.markSent(delivery.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MAX недоступен';
      if (error instanceof MaxApiError && (error.status === 403 || error.status === 404)) {
        await store.fail(delivery.id, `HTTP ${error.status}`);
      } else if (delivery.attempt >= MAX_ATTEMPTS) {
        await store.fail(delivery.id, message);
      } else {
        await store.retry(delivery.id, retryDelayMs(delivery.attempt), message);
      }
    }
  }
}

export function startDirectMessageOutboxWorker(
  store: DirectMessageOutboxStore,
  sender: DirectMessageSender,
  timer: { intervalMs: number; setInterval: (callback: () => void, delayMs: number) => unknown; clearInterval: (handle: unknown) => void },
): { stop: () => Promise<void>; readonly stopped: boolean } {
  let running = false;
  let stopped = false;
  let activeDrain: Promise<void> | null = null;
  const handle = timer.setInterval(() => {
    if (stopped || running) return;
    running = true;
    activeDrain = flushDirectMessageOutbox(store, sender).catch(() => undefined).finally(() => {
      running = false;
      activeDrain = null;
    });
  }, timer.intervalMs);
  return {
    get stopped() { return stopped; },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      timer.clearInterval(handle);
      await activeDrain;
    },
  };
}

export function createPgDirectMessageOutboxStore(pool: Pool): DirectMessageOutboxStore {
  return {
    async claim(limit) {
      const result = await pool.query<{
        id: string; userId: string; message: string; buttonText: string; buttonPayload: string; attempt: number;
      }>(
        `WITH selected AS (
           SELECT id FROM max_direct_message_outbox
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY next_attempt_at, id
            LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE max_direct_message_outbox outbox
            SET attempts = outbox.attempts + 1, next_attempt_at = now() + interval '${CLAIM_LEASE}'
           FROM selected
          WHERE outbox.id = selected.id
         RETURNING outbox.id, outbox.max_user_id AS "userId", outbox.message,
                   outbox.button_text AS "buttonText", outbox.button_payload AS "buttonPayload",
                   outbox.attempts AS attempt`,
        [limit],
      );
      return result.rows.map((row) => ({ ...row, userId: Number(row.userId) }));
    },
    async markSent(id) {
      await pool.query("UPDATE max_direct_message_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1", [id]);
    },
    async retry(id, delayMs, error) {
      await pool.query(
        "UPDATE max_direct_message_outbox SET next_attempt_at = now() + ($2 * interval '1 millisecond'), last_error = $3 WHERE id = $1",
        [id, delayMs, error.slice(0, 500)],
      );
    },
    async fail(id, error) {
      await pool.query("UPDATE max_direct_message_outbox SET status = 'failed', last_error = $2 WHERE id = $1", [id, error.slice(0, 500)]);
    },
  };
}
