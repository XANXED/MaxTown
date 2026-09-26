import { describe, expect, it } from 'vitest';
import type { UserNotification } from '@maxtown/shared';
import { groupByDay, markAllRead, markRead, unreadCount } from './notifications.ts';

const now = new Date(2026, 8, 25, 15, 0);

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
});
