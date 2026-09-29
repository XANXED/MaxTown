import { afterEach, expect, it, vi } from 'vitest';

const sessionModule = await import('./session.ts').catch(() => null);

afterEach(() => {
  sessionModule?.clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps the bearer token in memory and clears it on logout', () => {
  const storage = { setItem: vi.fn(), getItem: vi.fn() };
  const token = 'Q'.repeat(43);
  vi.stubGlobal('localStorage', storage);

  expect(typeof sessionModule?.setSession).toBe('function');
  expect(typeof sessionModule?.getSession).toBe('function');
  expect(typeof sessionModule?.clearSession).toBe('function');
  if (!sessionModule) return;

  sessionModule.setSession(token);
  expect(sessionModule.getSession()).toBe(token);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();
  sessionModule.clearSession();
  expect(sessionModule.getSession()).toBeNull();
});

it('sends signed MAX initData to the API and saves only the returned server token', async () => {
  const token = 'Q'.repeat(43);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => new Response(
    JSON.stringify({ token, expiresAt: '2026-10-03T12:00:00.000Z', pendingHouseSetups: [] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  if (!sessionModule) return;
  await sessionModule.authenticateWithMax('auth_date=1&hash=abc', -42);

  const [url, request] = fetchMock.mock.calls[0]!;
  expect(url).toBe('/api/auth/max');
  expect(request?.method).toBe('POST');
  expect(JSON.parse(String(request?.body))).toEqual({ initData: 'auth_date=1&hash=abc', chatId: -42 });
  expect(sessionModule.getSession()).toBe(token);
});

it('reports expired MAX launch data as 401 and does not keep a session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 })));
  if (!sessionModule) return;
  await expect(sessionModule.authenticateWithMax('auth_date=1&hash=abc')).rejects.toMatchObject({ status: 401 });
  expect(sessionModule.getSession()).toBeNull();
});

it('adds the in-memory bearer token to authenticated API calls', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  expect(typeof sessionModule?.apiFetch).toBe('function');
  if (!sessionModule?.apiFetch) return;
  sessionModule.setSession('Q'.repeat(43));
  await sessionModule.apiFetch('/api/me');

  const [, request] = fetchMock.mock.calls[0]!;
  expect(new Headers(request?.headers).get('authorization')).toBe(`Bearer ${'Q'.repeat(43)}`);
});
