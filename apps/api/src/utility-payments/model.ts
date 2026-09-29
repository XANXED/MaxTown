import type { UtilityPaymentState } from '@maxtown/shared';
import { HOUSE_TIME_ZONE } from '../house-time.ts';

export type UtilityPaymentReminderType = 'three-days' | 'due-today' | 'overdue-once';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOUSE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: HOUSE_TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
});

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('invalid_date');
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const lastDay = result.month >= 1 && result.month <= 12
    ? new Date(Date.UTC(result.year, result.month, 0)).getUTCDate()
    : 0;
  if (result.year < 1 || result.month < 1 || result.month > 12 || result.day < 1 || result.day > lastDay) {
    throw new Error('invalid_date');
  }
  return result;
}

function dateOrdinal(value: string): number {
  const { year, month, day } = parseDate(value);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Локальная дата Дома в стабильном формате YYYY-MM-DD. */
export function houseDate(now: Date): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function houseHour(now: Date): number {
  return Number(hourFormatter.format(now));
}

export function monthStart(value: string): string {
  const { year, month } = parseDate(value);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

export function addMonths(value: string, amount: number): string {
  const { year, month } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** День 29–31 в коротком месяце прижимается к последнему календарному дню. */
export function dueDateForMonth(billingMonth: string, dueDay: number): string {
  const { year, month } = parseDate(billingMonth);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('invalid_due_day');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
}

export function utilityPaymentState(input: {
  dueOn: string; paidAt: Date | null; skippedAt: Date | null; today: string;
}): UtilityPaymentState {
  if (input.paidAt) return 'paid';
  if (input.skippedAt) return 'skipped';
  const days = dateOrdinal(input.dueOn) - dateOrdinal(input.today);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due-today';
  if (days <= 3) return 'due-soon';
  return 'upcoming';
}

/** Этап напоминания для текущего дня; до 09:00 ничего не отправляется. */
export function reminderTypeFor(input: {
  dueOn: string; createdAt: Date; now: Date;
}): UtilityPaymentReminderType | null {
  if (houseHour(input.now) < 9) return null;
  const today = houseDate(input.now);
  const days = dateOrdinal(input.dueOn) - dateOrdinal(today);
  const type = days === 3 ? 'three-days' : days === 0 ? 'due-today' : days === -1 ? 'overdue-once' : null;
  if (!type) return null;
  const createdOn = houseDate(input.createdAt);
  if (createdOn > today || (createdOn === today && houseHour(input.createdAt) >= 9)) return null;
  return type;
}
