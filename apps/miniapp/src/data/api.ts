// Ответы apps/api для экранов: JSON или ошибка с понятным человеку текстом.

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Ошибка API: текст — для человека, код — для логики экрана. */
export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Тело ответа как JSON; при ошибке — ApiError с текстом по коду `{ error }`. */
export async function readApiJson<T>(response: Response, fallback: string, messages: Record<string, string> = {}): Promise<T> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Тела нет или оно не JSON: остаётся общий текст ошибки.
  }
  if (!response.ok) {
    const code = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : null;
    throw new ApiError((code && messages[code]) || fallback, code, response.status);
  }
  return data as T;
}

export function jsonRequest(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
