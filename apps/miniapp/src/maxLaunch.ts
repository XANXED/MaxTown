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
  // MAX дописывает параметры к настроенному URL мини-аппы. Если там уже был
  // маршрут, фактический URL имеет вид #/welcome?WebAppStartParam=…#WebAppData=….
  // Разделяем только внешние поля до URL-декодирования: %23/%3F внутри
  // подписанного initData должны остаться нетронутыми.
  const hashParams = new URLSearchParams(hash?.replace(/[?#](?=WebApp(?:Data|StartParam)=)/g, '&'));
  const queryParams = new URLSearchParams(window.location.search);
  let cached = launchCache.get(window);
  if (!cached) {
    cached = new Map();
    launchCache.set(window, cached);
  }
  // Запоминаем оба поля вместе: роутер может сменить hash до первого
  // обращения к start_param.
  for (const key of ['WebAppData', 'WebAppStartParam']) {
    const value = nonEmpty(hashParams.get(key)) ?? nonEmpty(queryParams.get(key));
    if (value) cached.set(key, value);
  }
  return cached.get(name);
}

/**
 * Подписанные данные текущего запуска MAX. Явные параметры URL приоритетнее
 * моста: если SDK не разобрал вложенный hash, он может вернуть из sessionStorage
 * данные предыдущего запуска. Подлинность в любом случае проверяет сервер.
 */
export function currentMaxInitData(): string | undefined {
  const fromUrl = launchParameter('WebAppData');
  return fromUrl ?? nonEmpty(window.WebApp?.initData);
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

/**
 * Параметр запуска из ссылки `max.ru/<бот>?startapp=…` или кнопки бота:
 * `inv_…` — Приглашение, `setup_…` — выбор адреса, `poll_…` — Опрос.
 * Только маршрутизация: права всё равно проверяет сервер.
 */
export function launchStartParam(): string | undefined {
  const fromUrl = launchParameter('WebAppStartParam');
  if (fromUrl) return fromUrl;

  const initData = currentMaxInitData();
  const fromInitData = nonEmpty(new URLSearchParams(initData ?? '').get('start_param'));
  if (fromInitData) return fromInitData;

  // initDataUnsafe может остаться от предыдущего открытия WebView. Используем
  // его только когда текущий запуск вообще не принёс подписанных данных.
  return initData ? undefined : nonEmpty(window.WebApp?.initDataUnsafe?.start_param);
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const pollStartParam = new RegExp(`^poll_(${uuid})_(${uuid})$`, 'i');

/** Опрос из кнопки бота «Проголосовать» в Домовом чате. */
export function launchPoll(): { houseId: string; pollId: string } | null {
  const match = pollStartParam.exec(launchStartParam() ?? '');
  return match ? { houseId: match[1]!, pollId: match[2]! } : null;
}
