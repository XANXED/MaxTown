import { describe, expect, it, vi } from 'vitest';
import { MaxApiError } from '../max/api.ts';
import { flushDirectMessageOutbox, type DirectMessageOutboxStore } from './direct-outbox.ts';

function store(attempt = 1) {
  const markSent = vi.fn(async () => undefined);
  const retry = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const value: DirectMessageOutboxStore = {
    claim: async () => [{
      id: 'delivery-1', userId: 42, message: 'Будет ремонт',
      buttonText: 'Открыть ремонт', buttonPayload: 'repair_house-1_repair-1', attempt,
    }],
    markSent,
    retry,
    fail,
  };
  return { value, markSent, retry, fail };
}

describe('flushDirectMessageOutbox', () => {
  it('sends a private message with a repair deep link', async () => {
    const target = store();
    const sendUserMessage = vi.fn(async () => undefined);

    await flushDirectMessageOutbox(target.value, { sendUserMessage });

    expect(sendUserMessage).toHaveBeenCalledWith(42, 'Будет ремонт', { text: 'Открыть ремонт', payload: 'repair_house-1_repair-1' });
    expect(target.markSent).toHaveBeenCalledWith('delivery-1');
  });

  it('does not retry a permanently unavailable private dialog', async () => {
    const target = store();
    const sendUserMessage = vi.fn(async () => { throw new MaxApiError('forbidden', 403); });

    await flushDirectMessageOutbox(target.value, { sendUserMessage });

    expect(target.fail).toHaveBeenCalledWith('delivery-1', 'HTTP 403');
    expect(target.retry).not.toHaveBeenCalled();
  });

  it('retries a temporary MAX failure', async () => {
    const target = store();
    const sendUserMessage = vi.fn(async () => { throw new MaxApiError('temporary'); });

    await flushDirectMessageOutbox(target.value, { sendUserMessage });

    expect(target.retry).toHaveBeenCalledWith('delivery-1', expect.any(Number), 'temporary');
    expect(target.fail).not.toHaveBeenCalled();
  });

  it('stops retrying a temporary failure after the final attempt', async () => {
    const target = store(8);
    const sendUserMessage = vi.fn(async () => { throw new MaxApiError('temporary'); });

    await flushDirectMessageOutbox(target.value, { sendUserMessage });

    expect(target.fail).toHaveBeenCalledWith('delivery-1', 'temporary');
    expect(target.retry).not.toHaveBeenCalled();
  });
});
