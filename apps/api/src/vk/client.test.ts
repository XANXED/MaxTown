import { describe, expect, it, vi } from 'vitest';
import { createVkMessageClient, VkApiError } from './client.ts';

describe('VK community API client', () => {
  it('sends messages using a group token, stable random ID, and configured API version', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ response: 987 }), { status: 200 }));
    const client = createVkMessageClient({ token: 'group-secret-token', groupId: 123, apiVersion: '5.199', fetch: fetcher });
    await client.send({ userId: '42', randomId: 12001, message: 'Откройте опрос https://vk.com/app123' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.vk.com/method/messages.send');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('access_token')).toBe('group-secret-token');
    expect(body.get('group_id')).toBe('123');
    expect(body.get('user_id')).toBe('42');
    expect(body.get('random_id')).toBe('12001');
    expect(body.get('v')).toBe('5.199');
  });

  it('preserves numeric VK error codes for permission-denial handling without exposing response text', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { error_code: 901, error_msg: 'private provider details' } }), { status: 200 }));
    const client = createVkMessageClient({ token: 'secret', groupId: 123, fetch: fetcher });
    await expect(client.send({ userId: '42', randomId: 1, message: 'sensitive message' }))
      .rejects.toMatchObject({ code: 901 });
    try {
      await client.send({ userId: '42', randomId: 2, message: 'sensitive message' });
    } catch (error) {
      expect(error).toBeInstanceOf(VkApiError);
      expect(String(error)).not.toContain('private provider details');
      expect(String(error)).not.toContain('sensitive message');
      expect(String(error)).not.toContain('secret');
    }
  });

  it('bounds requests with a timeout and rejects malformed responses', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('not-json', { status: 200 });
    });
    const client = createVkMessageClient({ token: 'secret', groupId: 123, fetch: fetcher });
    await expect(client.send({ userId: '42', randomId: 1, message: 'hello' })).rejects.toThrow(/VK API request failed/);
  });
});
