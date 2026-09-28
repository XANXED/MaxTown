import type { MaxAuthResponse } from '@maxtown/shared';
import { currentMaxInitData } from './maxLaunch.ts';

export class MaxAuthRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMaxAuthResponse(value: unknown): value is MaxAuthResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    !Array.isArray(value.houses) ||
    !Array.isArray(value.pendingHouseSetups)
  ) {
    return false;
  }
  return Number.isSafeInteger(value.user.id) && typeof value.user.firstName === 'string';
}

/**
 * Отправляет подписанные данные запуска на API. В браузерном демо без MAX
 * возвращает null и не подменяет серверную авторизацию фиктивным пользователем.
 */
export async function authorizeCurrentMaxUser(
  fetcher: typeof fetch = globalThis.fetch,
  initData: string | undefined = currentMaxInitData(),
): Promise<MaxAuthResponse | null> {
  if (!initData) return null;

  const response = await fetcher('/api/auth/max', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData }),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MaxAuthRequestError('API авторизации вернул некорректный ответ', response.status);
  }

  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === 'string' ? data.error : 'Не удалось войти через MAX';
    throw new MaxAuthRequestError(message, response.status);
  }
  if (!isMaxAuthResponse(data)) {
    throw new MaxAuthRequestError('API авторизации вернул данные неизвестного формата', response.status);
  }

  return data;
}
