import type { Pool } from 'pg';
import { inTransaction } from '../db/transaction.ts';
import { HOUSE_TIME_ZONE } from '../house-time.ts';
import { ensureUtilityPaymentPeriods } from './store.ts';
import { houseDate, reminderTypeFor, type UtilityPaymentReminderType } from './model.ts';

type DuePeriod = {
  id: string;
  house_id: string;
  apartment_id: string;
  apartment_household_id: string;
  title: string;
  due_on: string;
  created_at: Date;
};

const dueFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: HOUSE_TIME_ZONE });

function formatDueOn(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return dueFormat.format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}

function reminderCopy(type: UtilityPaymentReminderType, period: DuePeriod): { title: string; body: string } {
  const due = formatDueOn(period.due_on);
  if (type === 'three-days') return { title: 'Срок оплаты через 3 дня', body: `${period.title} · до ${due}` };
  if (type === 'due-today') return { title: 'Сегодня срок оплаты', body: `${period.title} · ${due}` };
  return { title: 'Платёж пока не отмечен', body: `${period.title} · срок был ${due}` };
}

/** Создать текущие периоды и адресные напоминания. Все вставки идемпотентны. */
export async function runUtilityPaymentMaintenance(pool: Pool, now = new Date()): Promise<{ periodsCreated: number; remindersCreated: number }> {
  return inTransaction(pool, async (client) => {
    const today = houseDate(now);
    const households = await client.query<{ apartment_household_id: string }>(
      `SELECT DISTINCT template.apartment_household_id
         FROM utility_payment_templates template
         JOIN apartment_households household ON household.id = template.apartment_household_id
        WHERE template.archived_at IS NULL AND template.starts_on <= $1::date AND household.ended_at IS NULL`,
      [today],
    );
    let periodsCreated = 0;
    for (const household of households.rows) {
      periodsCreated += await ensureUtilityPaymentPeriods(client, household.apartment_household_id, today);
    }

    const due = await client.query<DuePeriod>(
      `SELECT period.id, period.house_id, period.apartment_id, period.apartment_household_id,
              period.title, period.due_on::text, period.created_at
         FROM utility_payment_periods period
         JOIN apartment_households household ON household.id = period.apartment_household_id
        WHERE paid_at IS NULL AND skipped_at IS NULL
          AND household.ended_at IS NULL
          AND due_on BETWEEN ($1::date - interval '1 day') AND ($1::date + interval '3 days')
        ORDER BY due_on, id
        FOR UPDATE`,
      [today],
    );
    let remindersCreated = 0;
    for (const period of due.rows) {
      const type = reminderTypeFor({ dueOn: period.due_on, createdAt: period.created_at, now });
      if (!type) continue;
      const recipients = await client.query<{ resident_id: string; max_user_id: string | null }>(
        `SELECT DISTINCT membership.resident_id, resident.max_user_id
           FROM memberships membership
           JOIN residents resident ON resident.id = membership.resident_id
          WHERE membership.house_id = $1 AND membership.apartment_household_id = $2
            AND membership.ended_at IS NULL AND membership.role IN ('resident', 'admin')`,
        [period.house_id, period.apartment_household_id],
      );
      const copy = reminderCopy(type, period);
      for (const recipient of recipients.rows) {
        const notification = await client.query(
          `INSERT INTO in_app_notifications
             (resident_id, house_id, kind, title, body, utility_payment_period_id, utility_payment_reminder_type)
           VALUES ($1, $2, 'utility-payment', $3, $4, $5, $6)
           ON CONFLICT (resident_id, utility_payment_period_id, utility_payment_reminder_type)
             WHERE utility_payment_period_id IS NOT NULL DO NOTHING`,
          [recipient.resident_id, period.house_id, copy.title, copy.body, period.id, type],
        );
        remindersCreated += notification.rowCount ?? 0;
        if (recipient.max_user_id && /^[1-9][0-9]*$/.test(recipient.max_user_id)) {
          await client.query(
            `INSERT INTO max_direct_message_outbox
               (house_id, resident_id, max_user_id, event_kind, message, button_text, button_payload,
                dedupe_key, utility_payment_period_id, utility_payment_reminder_type)
             VALUES ($1::uuid, $2::uuid, $3::text::bigint, 'payment-reminder', $4::text, 'Открыть платёж',
                     'payment_' || $1::uuid::text || '_' || $5::uuid::text,
                     'payment:' || $5::uuid::text || ':' || $6::text || ':' || $3::text, $5::uuid, $6::text)
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [period.house_id, recipient.resident_id, recipient.max_user_id,
              `${copy.title}. ${copy.body}`, period.id, type],
          );
        }
      }
    }
    return { periodsCreated, remindersCreated };
  });
}

type Timer = {
  intervalMs: number;
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export function startUtilityPaymentMaintenance(
  pool: Pool,
  timer: Timer,
  onError: (error: unknown) => void,
): { stop: () => Promise<void> } {
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = runUtilityPaymentMaintenance(pool).catch(onError).finally(() => { running = null; });
  };
  const handle = timer.setInterval(tick, timer.intervalMs);
  return {
    stop: async () => {
      timer.clearInterval(handle);
      await running;
    },
  };
}
