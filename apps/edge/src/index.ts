// Публичный адрес MaxTown на Cloudflare: https://maxtown.maxtown-bot.workers.dev.
// Его уже знает MAX — мини-приложение открывается отсюда, сюда же приходит
// webhook бота. Статику мини-аппа Cloudflare отдаёт сам (assets в
// wrangler.jsonc), а /api/* Worker пересылает в API на Node и Postgres
// (docs/adr/0010): вход, Домовые чаты, DaData и все данные Дома живут там.

export type ProxyEnv = {
  /** Адрес API без пути, например https://maxtown.onrender.com. */
  API_ORIGIN?: string;
};

function json(data: unknown, status: number): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

/** Origin из настройки, только http(s) и без пути: сюда уходят и токен сессии, и webhook. */
function apiOrigin(env: ProxyEnv): URL | null {
  if (!env.API_ORIGIN?.trim()) return null;
  try {
    const url = new URL(env.API_ORIGIN.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? new URL(url.origin) : null;
  } catch {
    return null;
  }
}

export async function handleRequest(
  request: Request,
  env: ProxyEnv,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

  const origin = apiOrigin(env);
  if (!origin) return json({ error: 'api_origin_not_configured' }, 503);

  const target = new URL(`${url.pathname}${url.search}`, origin);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    return await fetcher(target.href, {
      method: request.method,
      headers,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      redirect: 'manual',
    });
  } catch {
    return json({ error: 'api_unavailable' }, 502);
  }
}

export default {
  fetch(request: Request, env: ProxyEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
