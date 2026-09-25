import type { HouseEventKind, RequestStatus } from '@maxtown/shared';

export const requestStatusLabels: Record<RequestStatus, string> = {
  new: 'Новая',
  'in-progress': 'В работе',
  done: 'Выполнена',
  closed: 'Закрыта',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

/** Как выделять статус: Выполненная Заявка ждёт ответа Жильца, поэтому она акцентная. */
export type StatusTone = 'neutral' | 'themed' | 'positive' | 'negative';

export const requestStatusTones: Record<RequestStatus, StatusTone> = {
  new: 'neutral',
  'in-progress': 'neutral',
  done: 'themed',
  closed: 'positive',
  rejected: 'negative',
  cancelled: 'neutral',
};

export const houseEventKindLabels: Record<HouseEventKind, string> = {
  accident: 'Авария',
  'planned-outage': 'Плановое отключение',
  announcement: 'Объявление',
};

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** «Сегодня, 10:24», «Вчера, 18:10» или «12 окт.». */
export function formatUpdatedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Сегодня, ${timeFormat.format(date)}`;
  if (days === 1) return `Вчера, ${timeFormat.format(date)}`;
  return dateFormat.format(date);
}
