import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserNotification } from '@maxtown/shared';
import { groupByDay, markAllNotificationsRead, markAllRead, markNotificationRead, markRead, unreadCount } from './notifications.ts';

const now = new Date(2026, 8, 25, 15, 0);

afterEach(() => vi.unstubAllGlobals());

function notification(id: string, at: Date, read = false): UserNotification {
  return { id, kind: 'request-status', title: id, at: at.toISOString(), read, requestId: 'r1' };
}

describe('groupByDay', () => {
  it('splits into today, yesterday and earlier, keeping order', () => {
    const groups = groupByDay(
      [
        notification('a', new Date(2026, 8, 25, 14)),
        notification('b', new Date(2026, 8, 25, 9)),
        notification('c', new Date(2026, 8, 24, 20)),
        notification('d', new Date(2026, 8, 20, 10)),
      ],
      now,
    );
    expect(groups.map(({ title, items }) => [title, items.map(({ id }) => id)])).toEqual([
      ['Сегодня', ['a', 'b']],
      ['Вчера', ['c']],
      ['Ранее', ['d']],
    ]);
  });

  it('skips empty groups', () => {
    expect(groupByDay([notification('d', new Date(2026, 8, 1))], now).map(({ title }) => title)).toEqual(['Ранее']);
  });
});

describe('read state', () => {
  const list = [notification('a', now), notification('b', now, true), notification('c', now)];

  it('counts unread', () => {
    expect(unreadCount(list)).toBe(2);
  });

  it('marks one or all as read', () => {
    expect(unreadCount(markRead(list, 'a'))).toBe(1);
    expect(unreadCount(markAllRead(list))).toBe(0);
  });

  it.each([
    ['одно уведомление', () => markNotificationRead('notice-1')],
    ['все уведомления', () => markAllNotificationsRead()],
  ])('не принимает ошибку API за успешное прочтение: %s', async (_label, request) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));

    await expect(request()).rejects.toThrow('Не удалось отметить уведомления прочитанными');
  });
});
