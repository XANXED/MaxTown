import { describe, expect, it, vi } from 'vitest';
import { createMaxApi } from './api.ts';

describe('MAX direct messages', () => {
  it('addresses a user and carries a mini-app payload', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = createMaxApi({ token: 'bot-token', botUsername: 'maxtown_bot', fetcher });

    await api.sendUserMessage(12345, 'Ремонт перенесён', { text: 'Открыть', payload: 'repair_abc' });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://platform-api2.max.ru/messages?user_id=12345');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      text: 'Ремонт перенесён',
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{
        type: 'open_app', text: 'Открыть', web_app: 'maxtown_bot', payload: 'repair_abc',
      }]] } }],
    });
  });
});
