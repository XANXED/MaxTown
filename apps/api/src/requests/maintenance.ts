import type { Pool } from 'pg';
import { inTransaction } from '../db/transaction.ts';
import { notifyResidents } from '../notifications/in-app.ts';

// Автозакрытие (docs/adr/0012): Выполненная Заявка ждёт ответа Жильца. Через
// 3 дня без ответа — напоминание, ещё через 2 дня — Заявка закрывается.

export const REMINDER_AFTER_DAYS = 3;
export const CLOSE_AFTER_REMINDER_DAYS = 2;

type DueRequest = { id: string; house_id: string; number: number; author_resident_id: string };

export async function runRequestMaintenance(pool: Pool, now = new Date()): Promise<{ reminded: number; closed: number }> {
  return inTransaction(pool, async (client) => {
    const reminded = await client.query<DueRequest>(
      `UPDATE requests SET reminded_at = $1
        WHERE status = 'done' AND reminded_at IS NULL AND done_at <= $1::timestamptz - interval '${REMINDER_AFTER_DAYS} days'
        RETURNING id, house_id, number, author_resident_id`,
      [now],
    );
    for (const request of reminded.rows) {
      await notifyResidents(client, [request.author_resident_id], {
        kind: 'request-status',
        houseId: request.house_id,
        requestId: request.id,
        title: `Проверьте Заявку № ${request.number}`,
        body: `Ответственный сообщил, что всё исправлено. Если не ответите, Заявка закроется через ${CLOSE_AFTER_REMINDER_DAYS} дня`,
      });
    }

    const closed = await client.query<DueRequest>(
      `UPDATE requests SET status = 'closed', updated_at = $1
        WHERE status = 'done' AND reminded_at <= $1::timestamptz - interval '${CLOSE_AFTER_REMINDER_DAYS} days'
        RETURNING id, house_id, number, author_resident_id`,
      [now],
    );
    for (const request of closed.rows) {
      await client.query(
        `INSERT INTO request_status_changes (request_id, status, note, actor_resident_id, created_at)
         VALUES ($1, 'closed', 'Закрыта автоматически: ответа не было после напоминания', NULL, $2)`,
        [request.id, now],
      );
      await notifyResidents(client, [request.author_resident_id], {
        kind: 'request-status',
        houseId: request.house_id,
        requestId: request.id,
        title: `Заявка № ${request.number} закрыта`,
        body: 'Ответа не было после напоминания. Если неисправность осталась, подайте новую Заявку',
      });
    }
    return { reminded: reminded.rowCount ?? 0, closed: closed.rowCount ?? 0 };
  });
}

type Timer = {
  intervalMs: number;
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/** Проверять Заявки по таймеру; ошибка одного прохода не останавливает следующие. */
export function startRequestMaintenance(pool: Pool, timer: Timer, onError: (error: unknown) => void): { stop: () => Promise<void> } {
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = runRequestMaintenance(pool).catch(onError).finally(() => { running = null; });
  };
  const handle = timer.setInterval(tick, timer.intervalMs);
  return {
    stop: async () => {
      timer.clearInterval(handle);
      await running;
    },
  };
}
