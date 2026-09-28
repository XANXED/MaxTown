import { describe, expect, it, vi } from 'vitest';
import type { UserNotification } from '@maxtown/shared';
import { groupByDay, markAllRead, markRead, requestVkMessagesPermission, unreadCount } from './notifications.ts';

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

describe('VK messages permission', () => {
  it('persists opt-in only after VK returns an explicit success result', async () => {
    const bridge = { send: vi.fn(async () => ({ result: true })) };
    const persist = vi.fn(async () => undefined);
    expect(await requestVkMessagesPermission(bridge, 123, persist)).toBe(true);
    expect(bridge.send).toHaveBeenCalledWith('VKWebAppAllowMessagesFromGroup', { group_id: 123 });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not persist when the bridge does not confirm opt-in', async () => {
    const bridge = { send: vi.fn(async () => ({ result: false })) };
    const persist = vi.fn(async () => undefined);
    expect(await requestVkMessagesPermission(bridge, 123, persist)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
