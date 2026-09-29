import { describe, expect, it, vi } from 'vitest';
import { flushNotificationOutbox, pollStartParam, retryDelayMs, startNotificationOutboxWorker, type ChatAnnouncement, type OutboxStore } from './outbox.ts';

const announcement: ChatAnnouncement = {
  id: 'announcement-1', chatId: -7001, houseId: 'house-1', pollId: 'poll-1', question: 'Нужен ли ремонт?', attempt: 1,
};

function store(pending = [announcement]) {
  return {
    claim: vi.fn(async () => pending),
    markSent: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  } satisfies OutboxStore;
}

describe('объявление Опроса в Домовом чате', () => {
  it('пишет в чат с кнопкой, которая открывает Опрос, и отмечает отправку', async () => {
    const repository = store();
    const sendChatMessage = vi.fn(async () => undefined);
    await flushNotificationOutbox(repository, { sendChatMessage }, 20);
    expect(sendChatMessage).toHaveBeenCalledWith(-7001, expect.stringContaining('Нужен ли ремонт?'), {
      text: 'Проголосовать', payload: 'poll_house-1_poll-1',
    });
    expect(repository.markSent).toHaveBeenCalledWith(announcement.id);
  });

  it('параметр запуска укладывается в правила MAX: латиница, цифры, «_» и «-»', () => {
    const payload = pollStartParam('3ce05158-0792-429c-9129-99c12e1e5366', 'a1b2c3d4-0000-4000-8000-000000000001');
    expect(payload).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
  });

  it('повторяет сбой с растущей паузой, а исчерпанные попытки помечает неудачными', async () => {
    const repository = store();
    const sendChatMessage = vi.fn(async () => { throw new Error('temporary'); });
    await flushNotificationOutbox(repository, { sendChatMessage }, 20);
    expect(repository.retry).toHaveBeenCalledWith(announcement.id, retryDelayMs(1));
    expect(retryDelayMs(100)).toBeLessThanOrEqual(3_600_000);
    const exhausted = store([{ ...announcement, id: 'announcement-8', attempt: 8 }]);
    await flushNotificationOutbox(exhausted, { sendChatMessage }, 20);
    expect(exhausted.fail).toHaveBeenCalledWith('announcement-8');
    expect(exhausted.retry).not.toHaveBeenCalled();
  });

  it('не запускает проходы внахлёст и останавливается чисто', async () => {
    let tick: (() => void) | undefined;
    const repository = store();
    let finish!: () => void;
    const sendChatMessage = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const worker = startNotificationOutboxWorker(repository, { sendChatMessage }, {
      intervalMs: 1000,
      setInterval: (callback) => { tick = callback; return 1; },
      clearInterval: vi.fn(),
    });
    tick?.(); tick?.();
    await Promise.resolve();
    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await worker.stop();
    expect(worker.stopped).toBe(true);
  });
});
