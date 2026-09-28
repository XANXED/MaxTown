export class RequestTimeoutError extends Error {
  constructor() {
    super('Время ожидания ответа истекло');
    this.name = 'RequestTimeoutError';
  }
}

/** Ограничивает весь запрос, включая чтение тела, и отменяет сетевую операцию. */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequestTimeoutError());
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
