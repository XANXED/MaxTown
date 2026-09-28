import { describe, expect, it, vi } from 'vitest';
import { flushNotificationOutbox, retryDelayMs, type OutboxDelivery, type OutboxStore } from './outbox.ts';

const delivery: OutboxDelivery = {
  id: 'delivery-1', residentId: 'resident-1', vkUserId: '42', pollId: 'poll-1',
  houseAddress: 'ул. Лесная, 12', question: 'Нужен ли ремонт?', appUrl: 'https://vk.com/app123?poll=poll-1', randomId: 123, attempt: 1,
};

function store(pending = [delivery]) {
  return {
    claim: vi.fn(async () => pending),
    markSent: vi.fn(async () => undefined),
    markDenied: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  } satisfies OutboxStore;
}

describe('notification outbox', () => {
  it('sends only claimed eligible deliveries and marks success', async () => {
    const repository = store();
    const send = vi.fn(async () => undefined);
    await flushNotificationOutbox(repository, { send }, 20);
    expect(send).toHaveBeenCalledWith({ userId: '42', randomId: 123, message: expect.stringContaining(delivery.appUrl) });
    expect(repository.markSent).toHaveBeenCalledWith(delivery.id);
  });

  it('marks VK permission denial as permanent and never retries it', async () => {
    const repository = store();
    const send = vi.fn(async () => { throw Object.assign(new Error('forbidden'), { code: 901 }); });
    await flushNotificationOutbox(repository, { send }, 20);
    expect(repository.markDenied).toHaveBeenCalledWith(delivery.id);
    expect(repository.retry).not.toHaveBeenCalled();
  });

  it('retries transient failures with bounded exponential delays then marks exhausted records failed', async () => {
    const repository = store();
    const send = vi.fn(async () => { throw new Error('temporary'); });
    await flushNotificationOutbox(repository, { send }, 20);
    expect(repository.retry).toHaveBeenCalledWith(delivery.id, retryDelayMs(1));
    expect(retryDelayMs(100)).toBeLessThanOrEqual(3_600_000);
    const exhausted = store();
    exhausted.claim.mockResolvedValue([{ ...delivery, id: 'delivery-8', attempt: 8 }]);
    await flushNotificationOutbox(exhausted, { send }, 20);
    expect(exhausted.fail).toHaveBeenCalledWith('delivery-8');
    expect(exhausted.retry).not.toHaveBeenCalled();
  });

  it('does not retry provider rejections that cannot succeed without configuration changes', async () => {
    const repository = store();
    const send = vi.fn(async () => { throw Object.assign(new Error('bad request'), { retryable: false }); });
    await flushNotificationOutbox(repository, { send }, 20);
    expect(repository.fail).toHaveBeenCalledWith(delivery.id);
    expect(repository.retry).not.toHaveBeenCalled();
  });

  it('does not start overlapping worker drains and supports clean shutdown', async () => {
    let tick: (() => void) | undefined;
    const repository = store();
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const worker = (await import('./outbox.ts')).startNotificationOutboxWorker(repository, { send }, {
      intervalMs: 1000,
      setInterval: (callback) => { tick = callback; return 1; },
      clearInterval: vi.fn(),
    });
    tick?.(); tick?.();
    await Promise.resolve();
    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    worker.stop();
    expect(worker.stopped).toBe(true);
  });
});
