function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Хеш использует и MAX, и наш роутер. Сохраняем параметры только в памяти
// текущего окна, до первого перехода; подписанные данные не пишем в storage.
const launchCache = new WeakMap<object, Map<string, string>>();

export function launchParameter(name: string): string | undefined {
  const hash = window.location.hash?.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  let cached = launchCache.get(window);
  if (!cached) {
    cached = new Map();
    launchCache.set(window, cached);
  }
  // Запоминаем оба поля вместе: роутер может сменить hash до первого
  // обращения к start_param.
  for (const key of ['WebAppData', 'WebAppStartParam']) {
    const value = nonEmpty(new URLSearchParams(hash).get(key)) ?? nonEmpty(new URLSearchParams(window.location.search).get(key));
    if (value) cached.set(key, value);
  }
  return cached.get(name);
}

/**
 * Подписанные данные запуска MAX. Мост остаётся основным источником, а URL —
 * резервным: клиент MAX передаёт те же данные в параметре WebAppData ещё до
 * того, как внешний скрипт успевает заполнить window.WebApp.
 */
export function currentMaxInitData(): string | undefined {
  const fromUrl = launchParameter('WebAppData');
  return nonEmpty(window.WebApp?.initData) ?? fromUrl;
}

/** Оставляем переданные MAX параметры во фрагменте URL при навигации.
 * Они не уходят HTTP-серверу и остаются доступны после перезагрузки WebView. */
export function maxNavigationHash(routeHash: string): string {
  const params = new URLSearchParams();
  for (const key of ['WebAppData', 'WebAppStartParam']) {
    const value = launchParameter(key);
    if (value) params.set(key, value);
  }
  return params.size > 0 ? `${routeHash}&${params}` : routeHash;
}

type Wait = (milliseconds: number) => Promise<void>;

const MAX_INIT_DATA_POLL_MS = 50;
const MAX_INIT_DATA_ATTEMPTS = 100;

export async function waitForMaxInitData(
  wait: Wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  attempts = MAX_INIT_DATA_ATTEMPTS,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const initData = currentMaxInitData();
    if (initData) return initData;
    if (attempt < attempts - 1) await wait(MAX_INIT_DATA_POLL_MS);
  }

  return undefined;
}
