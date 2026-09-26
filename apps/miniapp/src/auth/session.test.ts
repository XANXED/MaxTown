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

it('sends raw MAX initData to the auth endpoint and saves only the returned token', async () => {
  const token = 'Q'.repeat(43);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => new Response(
    JSON.stringify({ token, expiresAt: '2026-10-03T12:00:00.000Z' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);

  expect(typeof sessionModule?.authenticateWithMax).toBe('function');
  if (!sessionModule?.authenticateWithMax) return;
  await sessionModule.authenticateWithMax('raw=MAX%20initData');

  const [, request] = fetchMock.mock.calls[0]!;
  expect(request?.method).toBe('POST');
  expect(JSON.parse(String(request?.body))).toEqual({ initData: 'raw=MAX%20initData' });
  expect(sessionModule.getSession()).toBe(token);
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
