import type { MaxAuthSessionResponse, MeResponse } from '@maxtown/shared';
import { RequestTimeoutError, withTimeout } from '@maxtown/shared/http';

// Серверная сессия MaxTown. Личность подтверждает API по подписанному initData
// MAX; токен сессии живёт только в памяти окна, в хранилище не пишется.

let sessionToken: string | null = null;
let pendingAuthentication: Promise<MaxAuthSessionResponse> | null = null;

/** Вход не удался; status — HTTP-код ответа API (504 — не дождались). */
export class AuthRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

const AUTH_TIMEOUT_MS = 20_000;

async function requestMaxSession(initData: string, chatId: number | null): Promise<MaxAuthSessionResponse> {
  let response: Response;
  try {
    response = await withTimeout((signal) => fetch('/api/auth/max', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, ...(chatId !== null ? { chatId } : {}) }),
      signal,
    }), AUTH_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw new AuthRequestError('Проверка доступа затянулась. Попробуйте ещё раз', 504);
    throw new AuthRequestError('Нет связи с MaxTown. Проверьте интернет', 0);
  }
  if (response.status === 401) throw new AuthRequestError('Данные запуска MAX устарели. Закройте и снова откройте мини-приложение', 401);
  if (!response.ok) throw new AuthRequestError('Не удалось подтвердить вход через MAX', response.status);

  const result = await response.json() as MaxAuthSessionResponse;
  if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)
    || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))
    || !Array.isArray(result.pendingHouseSetups)) {
    throw new AuthRequestError('Сервер вернул некорректную сессию', response.status);
  }
  setSession(result.token);
  return result;
}

/** Обменять подписанный initData MAX на серверную сессию. chatId — чат из параметра запуска. */
export function authenticateWithMax(initData: string, chatId: number | null = null): Promise<MaxAuthSessionResponse> {
  if (!initData) return Promise.reject(new AuthRequestError('Откройте MaxTown кнопкой из чата MAX', 401));
  if (pendingAuthentication) return pendingAuthentication;

  pendingAuthentication = requestMaxSession(initData, chatId).finally(() => {
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

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}
