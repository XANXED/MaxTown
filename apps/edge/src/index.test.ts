import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from './index.ts';

const env = { API_ORIGIN: 'https://maxtown.onrender.com' };

describe('Worker MaxTown — прокси к API', () => {
  it('пересылает /api/* в API вместе с методом, заголовками и телом', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ token: 't' }));
    const request = new Request('https://maxtown.maxtown-bot.workers.dev/api/auth/max?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': 'secret' },
      body: JSON.stringify({ initData: 'signed' }),
    });

    const response = await handleRequest(request, env, fetcher);

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://maxtown.onrender.com/api/auth/max?x=1');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-max-bot-api-secret')).toBe('secret');
    expect(headers.get('x-forwarded-host')).toBe('maxtown.maxtown-bot.workers.dev');
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"initData":"signed"}');
  });

  it('не пересылает запросы вне /api', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleRequest(new Request('https://maxtown.maxtown-bot.workers.dev/apiary'), env, fetcher);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('без API_ORIGIN или с чужой схемой отвечает 503, а недоступный API — 502', async () => {
    const request = () => new Request('https://maxtown.maxtown-bot.workers.dev/api/health');
    expect((await handleRequest(request(), {})).status).toBe(503);
    expect((await handleRequest(request(), { API_ORIGIN: 'ftp://api' })).status).toBe(503);
    const failing = vi.fn<typeof fetch>(async () => { throw new TypeError('network'); });
    expect((await handleRequest(request(), env, failing)).status).toBe(502);
  });

  it('путь из запроса не меняет адрес API', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await handleRequest(new Request('https://maxtown.maxtown-bot.workers.dev/api//evil.example/x'), env, fetcher);
    expect(new URL(String(fetcher.mock.calls[0]![0])).host).toBe('maxtown.onrender.com');
  });
});
