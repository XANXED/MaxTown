import { useCallback, useEffect, useState } from 'react';

// Данные панели. API ещё нет: в сборке всегда пусто и готово.
// Только при `npm run dev:admin` адрес включает пример: ?demo=filled,
// ?demo=loading, ?demo=error. Фикстуры грузит только loadFixtures(), где
// import() стоит под import.meta.env.DEV, — в сборку они не попадают.

export type LoadStatus = 'loading' | 'ready' | 'error';

type DemoMode = 'filled' | 'loading' | 'error';

type Fixtures = typeof import('./fixtures.ts');

export function parseDemoMode(search: string): DemoMode | null {
  const mode = new URLSearchParams(search).get('demo');
  return mode === 'filled' || mode === 'loading' || mode === 'error' ? mode : null;
}

function loadFixtures(): Promise<Fixtures> | null {
  return import.meta.env.DEV ? import('./fixtures.ts') : null;
}

export function useLoadable<T>(empty: T, pickDemo: (fixtures: Fixtures) => T) {
  const [mode] = useState(() => (import.meta.env.DEV ? parseDemoMode(window.location.search) : null));
  const [status, setStatus] = useState<LoadStatus>(mode === 'error' ? 'error' : mode ? 'loading' : 'ready');
  const [data, setData] = useState<T>(empty);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode === null || mode === 'loading' || (mode === 'error' && attempt === 0)) return;
    const fixtures = loadFixtures();
    if (!fixtures) return;
    let cancelled = false;
    void fixtures.then((module) => {
      if (cancelled) return;
      setData(pickDemo(module));
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
    // pickDemo — новая функция на каждый рендер: перезагрузка только по «Повторить».
  }, [mode, attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((current) => current + 1);
  }, []);

  return { status, data, retry };
}
