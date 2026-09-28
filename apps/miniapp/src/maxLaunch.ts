function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function launchParameter(name: string): string | undefined {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fromHash = nonEmpty(new URLSearchParams(hash).get(name));
  if (fromHash) return fromHash;

  return nonEmpty(new URLSearchParams(window.location.search).get(name));
}

/**
 * Подписанные данные запуска MAX. Мост остаётся основным источником, а URL —
 * резервным: клиент MAX передаёт те же данные в параметре WebAppData ещё до
 * того, как внешний скрипт успевает заполнить window.WebApp.
 */
export function currentMaxInitData(): string | undefined {
  return nonEmpty(window.WebApp?.initData) ?? launchParameter('WebAppData');
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
