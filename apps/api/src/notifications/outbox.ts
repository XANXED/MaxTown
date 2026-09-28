import type { Pool, PoolClient } from 'pg';

export type OutboxDelivery = {
  id: string;
  residentId: string;
  vkUserId: string;
  pollId: string;
  houseAddress: string;
  question: string;
  appUrl: string;
  randomId: number;
  attempt: number;
};

export type VkMessage = { userId: string; randomId: number; message: string };
export type VkMessageSender = { send: (message: VkMessage) => Promise<void> };
export type OutboxStore = {
  claim: (limit: number) => Promise<OutboxDelivery[]>;
  markSent: (id: string) => Promise<void>;
  markDenied: (id: string) => Promise<void>;
  retry: (id: string, delayMs: number) => Promise<void>;
  fail: (id: string) => Promise<void>;
};

export async function enqueuePollNotifications(client: PoolClient, houseId: string, pollId: string): Promise<void> {
  await client.query(
    `INSERT INTO in_app_notifications (resident_id, house_id, poll_id)
     SELECT DISTINCT membership.resident_id, membership.house_id, $2::uuid
       FROM memberships membership
      WHERE membership.house_id = $1 AND membership.ended_at IS NULL
     ON CONFLICT (resident_id, poll_id) DO NOTHING`,
    [houseId, pollId],
  );
  await client.query(
    `INSERT INTO vk_notification_outbox (poll_id, house_id, membership_id, resident_id, vk_user_id)
     SELECT $2::uuid, membership.house_id, membership.id, membership.resident_id, resident.vk_user_id
       FROM memberships membership
       JOIN residents resident ON resident.id = membership.resident_id
       JOIN resident_message_permissions permission ON permission.resident_id = resident.id AND permission.status = 'allowed'
      WHERE membership.house_id = $1 AND membership.ended_at IS NULL AND resident.vk_user_id IS NOT NULL
     ON CONFLICT (poll_id, membership_id) DO NOTHING`,
    [houseId, pollId],
  );
}

const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 3_600_000;
const MAX_BATCH_SIZE = 50;

export function retryDelayMs(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, attempt - 1));
}

function vkErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'number' ? code : null;
}

function isRetryable(error: unknown): boolean {
  return !error || typeof error !== 'object' || !('retryable' in error) || error.retryable !== false;
}

export async function flushNotificationOutbox(store: OutboxStore, sender: VkMessageSender, limit = 20): Promise<void> {
  const deliveries = await store.claim(Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(limit))));
  for (const delivery of deliveries) {
    try {
      await sender.send({
        userId: delivery.vkUserId,
        randomId: delivery.randomId,
        message: `В Доме по адресу ${delivery.houseAddress} начался анонимный опрос «${delivery.question}». Проголосуйте: ${delivery.appUrl}`,
      });
      await store.markSent(delivery.id);
    } catch (error) {
      if (vkErrorCode(error) === 901) {
        await store.markDenied(delivery.id);
      } else if (!isRetryable(error) || delivery.attempt >= MAX_ATTEMPTS) {
        await store.fail(delivery.id);
      } else {
        await store.retry(delivery.id, retryDelayMs(delivery.attempt));
      }
    }
  }
}

export function startNotificationOutboxWorker(
  store: OutboxStore,
  sender: VkMessageSender,
  timer: { intervalMs: number; setInterval: (callback: () => void, delayMs: number) => unknown; clearInterval: (handle: unknown) => void },
): { stop: () => Promise<void>; readonly stopped: boolean } {
  let running = false;
  let stopped = false;
  let activeDrain: Promise<void> | null = null;
  const handle = timer.setInterval(() => {
    if (stopped || running) return;
    running = true;
    activeDrain = flushNotificationOutbox(store, sender).catch(() => undefined).finally(() => {
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

export function createPgOutboxStore(pool: Pool, appId: number): OutboxStore {
  return {
    async claim(limit) {
      const result = await pool.query<OutboxDelivery>(
        `WITH selected AS (
           SELECT id FROM vk_notification_outbox
            WHERE (status = 'pending' AND available_at <= now())
               OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
            ORDER BY available_at, id
            LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE vk_notification_outbox outbox
            SET status = 'processing', attempt_count = attempt_count + 1, locked_at = now()
           FROM selected, polls, houses
          WHERE outbox.id = selected.id AND polls.id = outbox.poll_id AND houses.id = outbox.house_id
         RETURNING outbox.id, outbox.resident_id AS "residentId", outbox.vk_user_id AS "vkUserId",
                   outbox.poll_id AS "pollId", houses.address AS "houseAddress", polls.question, outbox.provider_random_id AS "randomId",
                   outbox.attempt_count AS attempt,
                   ('https://vk.com/app' || $2 || '?house_id=' || outbox.house_id || '&poll_id=' || outbox.poll_id || '#community') AS "appUrl"`,
        [limit, appId],
      );
      return result.rows;
    },
    async markSent(id) {
      await pool.query("UPDATE vk_notification_outbox SET status = 'sent', sent_at = now(), locked_at = NULL WHERE id = $1", [id]);
    },
    async markDenied(id) {
      await pool.query("UPDATE vk_notification_outbox SET status = 'denied', locked_at = NULL, last_error_code = 'permission_denied' WHERE id = $1", [id]);
      await pool.query(
        `UPDATE resident_message_permissions SET status = 'denied', updated_at = now()
          WHERE resident_id = (SELECT resident_id FROM vk_notification_outbox WHERE id = $1)`, [id],
      );
    },
    async retry(id, delayMs) {
      await pool.query("UPDATE vk_notification_outbox SET status = 'pending', locked_at = NULL, available_at = now() + ($2 * interval '1 millisecond'), last_error_code = 'temporary_failure' WHERE id = $1", [id, delayMs]);
    },
    async fail(id) {
      await pool.query("UPDATE vk_notification_outbox SET status = 'failed', locked_at = NULL, last_error_code = 'retry_exhausted' WHERE id = $1", [id]);
    },
  };
}
