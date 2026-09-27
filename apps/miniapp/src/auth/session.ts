import type { AuthSessionResponse, MeResponse } from '@maxtown/shared';

let sessionToken: string | null = null;
let pendingAuthentication: Promise<AuthSessionResponse> | null = null;

export function getSession(): string | null {
  return sessionToken;
}

export function setSession(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Некорректная серверная сессия');
  sessionToken = token;
}

export function clearSession(): void {
  sessionToken = null;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  return fetch(input, { ...init, headers });
}

async function requestVkSession(launchParams: string): Promise<AuthSessionResponse> {
  const response = await fetch('/api/auth/vk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launchParams }),
  });
  if (!response.ok) throw new Error('Не удалось подтвердить вход через VK');

  const result = await response.json() as AuthSessionResponse;
  if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)
    || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) {
    throw new Error('Сервер вернул некорректную сессию');
  }
  setSession(result.token);
  return result;
}

export function authenticateWithVk(launchParams: string): Promise<AuthSessionResponse> {
  if (!launchParams) return Promise.reject(new Error('Параметры запуска VK отсутствуют'));
  if (pendingAuthentication) return pendingAuthentication;

  pendingAuthentication = requestVkSession(launchParams).finally(() => {
    pendingAuthentication = null;
  });
  return pendingAuthentication;
}

export async function getCurrentResident(): Promise<MeResponse> {
  const response = await apiFetch('/api/me');
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new Error('Не удалось загрузить профиль Жильца');
  }
  return response.json() as Promise<MeResponse>;
}

export async function logoutFromVk(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}
