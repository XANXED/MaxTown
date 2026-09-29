import type { Pool, PoolClient } from 'pg';
import type { MaxOpenAppButton } from '../max/api.ts';

// Новый Опрос: каждому Жильцу — уведомление в мини-аппе, а в Домовой чат —
// одно сообщение бота с кнопкой. Личных рассылок нет (docs/adr/0006):
// бот не пишет людям, которые с ним не разговаривали.

export type ChatAnnouncement = {
  id: string;
  chatId: number;
  houseId: string;
  pollId: string;
  question: string;
  attempt: number;
};

export type ChatMessageSender = {
  sendChatMessage: (chatId: number, text: string, button?: MaxOpenAppButton) => Promise<void>;
};

export type OutboxStore = {
  claim: (limit: number) => Promise<ChatAnnouncement[]>;
  markSent: (id: string) => Promise<void>;
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
    `INSERT INTO house_chat_outbox (house_id, poll_id)
     SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM house_chats WHERE house_id = $1 AND disconnected_at IS NULL)
     ON CONFLICT (poll_id) DO NOTHING`,
    [houseId, pollId],
  );
}

const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 3_600_000;
const MAX_BATCH_SIZE = 50;
/** Сколько запись считается занятой отправкой, прежде чем её возьмут снова. */
const CLAIM_LEASE = '5 minutes';

export function retryDelayMs(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/** Параметр запуска мини-аппа: сразу открыть Опрос нужного Дома. */
export function pollStartParam(houseId: string, pollId: string): string {
  return `poll_${houseId}_${pollId}`;
}

export async function flushNotificationOutbox(store: OutboxStore, sender: ChatMessageSender, limit = 20): Promise<void> {
  const announcements = await store.claim(Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(limit))));
  for (const announcement of announcements) {
    try {
      await sender.sendChatMessage(
        announcement.chatId,
        `Новый анонимный опрос: «${announcement.question}». Проголосовать можно в MaxTown.`,
        { text: 'Проголосовать', payload: pollStartParam(announcement.houseId, announcement.pollId) },
      );
      await store.markSent(announcement.id);
    } catch {
      if (announcement.attempt >= MAX_ATTEMPTS) await store.fail(announcement.id);
      else await store.retry(announcement.id, retryDelayMs(announcement.attempt));
    }
  }
}

export function startNotificationOutboxWorker(
  store: OutboxStore,
  sender: ChatMessageSender,
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

export function createPgOutboxStore(pool: Pool): OutboxStore {
  return {
    async claim(limit) {
      // Взятая запись откладывается на время аренды: упавшая отправка не
      // потеряется, а параллельный проход её не возьмёт.
      const result = await pool.query<ChatAnnouncement & { chatId: string }>(
        `WITH selected AS (
           SELECT outbox.id FROM house_chat_outbox outbox
            WHERE outbox.status = 'pending' AND outbox.next_attempt_at <= now()
            ORDER BY outbox.next_attempt_at, outbox.id
            LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE house_chat_outbox outbox
            SET attempts = outbox.attempts + 1, next_attempt_at = now() + interval '${CLAIM_LEASE}'
           FROM selected, polls, house_chats chat
          WHERE outbox.id = selected.id AND polls.id = outbox.poll_id
            AND chat.house_id = outbox.house_id AND chat.disconnected_at IS NULL
         RETURNING outbox.id, chat.chat_id AS "chatId", outbox.house_id AS "houseId", outbox.poll_id AS "pollId",
                   polls.question, outbox.attempts AS attempt`,
        [limit],
      );
      return result.rows.map((row) => ({ ...row, chatId: Number(row.chatId) }));
    },
    async markSent(id) {
      await pool.query("UPDATE house_chat_outbox SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
    },
    async retry(id, delayMs) {
      await pool.query("UPDATE house_chat_outbox SET next_attempt_at = now() + ($2 * interval '1 millisecond') WHERE id = $1", [id, delayMs]);
    },
    async fail(id) {
      await pool.query("UPDATE house_chat_outbox SET status = 'failed' WHERE id = $1", [id]);
    },
  };
}
