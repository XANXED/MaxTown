import type { UserNotification } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';

export type NotificationGroup = { title: string; items: UserNotification[] };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** «Сегодня», «Вчера», «Ранее» — пустые группы не показываем. Порядок внутри сохраняется. */
export function groupByDay(items: UserNotification[], now: Date): NotificationGroup[] {
  const today = startOfDay(now);
  const groups: NotificationGroup[] = [
    { title: 'Сегодня', items: [] },
    { title: 'Вчера', items: [] },
    { title: 'Ранее', items: [] },
  ];
  for (const item of items) {
    const days = Math.round((today - startOfDay(new Date(item.at))) / 86_400_000);
    groups[days <= 0 ? 0 : days === 1 ? 1 : 2]?.items.push(item);
  }
  return groups.filter(({ items: groupItems }) => groupItems.length > 0);
}

export function unreadCount(items: UserNotification[]): number {
  return items.filter(({ read }) => !read).length;
}

export function markRead(items: UserNotification[], id: string): UserNotification[] {
  return items.map((item) => (item.id === id ? { ...item, read: true } : item));
}

export function markAllRead(items: UserNotification[]): UserNotification[] {
  return items.map((item) => (item.read ? item : { ...item, read: true }));
}

/** Уведомления человека, новые сверху. Без API — пусто; примеры для dev — см. loadable.ts. */
export function useNotifications(): Loadable<UserNotification[]> {
  return useLoadable<UserNotification[]>([], ({ sampleNotifications }) => sampleNotifications());
}
