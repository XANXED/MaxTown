import { useCallback, useEffect, useState } from 'react';

// Общий каркас для данных экранов. API ещё нет, поэтому в сборке данные
// всегда пустые и готовые; запрос к apps/api появится в каждом хуке сам.
//
// Только при `npm run dev` адрес переключает пример:
//   ?demo=filled  — данные из fixtures.ts
//   ?demo=loading — вечные скелетоны
//   ?demo=error   — ошибка загрузки; «Повторить» подгружает примеры
//   ?demo=house-setup — выбор адреса при подключении Домового чата
// Фикстуры грузит только loadFixtures(): import() стоит прямо под
// import.meta.env.DEV, сборщик выкидывает его вместе с fixtures.ts.
// Не переносите import('./fixtures.ts') в другие места — чанк с примерами
// попадёт в dist.

/** Модуль примеров — только как тип, в сборку он не попадает. */
export type Fixtures = typeof import('./fixtures.ts');

/** Примеры для dev; в сборке null. */
export function loadFixtures(): Promise<Fixtures> | null {
  return import.meta.env.DEV ? import('./fixtures.ts') : null;
}

export type DemoMode = 'filled' | 'loading' | 'error' | 'house-setup';

export type LoadStatus = 'loading' | 'ready' | 'error';

export type Loadable<T> = {
  status: LoadStatus;
  data: T;
  retry: () => void;
};

const demoModes = new Set<string>(['filled', 'loading', 'error', 'house-setup']);

/** Режим примера из строки запроса: `?demo=filled` → 'filled'. Незнакомый — null. */
export function parseDemoMode(search: string): DemoMode | null {
  const mode = new URLSearchParams(search).get('demo');
  return mode && demoModes.has(mode) ? (mode as DemoMode) : null;
}

/** Режим примера; в сборке всегда null. */
export function demoMode(): DemoMode | null {
  if (!import.meta.env.DEV) return null;
  return parseDemoMode(window.location.search);
}

/** С чего начинает экран: пример грузится — скелетоны, ошибка — сразу ошибка. */
export function initialStatus(mode: DemoMode | null): LoadStatus {
  if (mode === 'error') return 'error';
  if (mode === 'filled' || mode === 'loading') return 'loading';
  return 'ready';
}

/**
 * Данные экрана. `empty` — то, что показывается без API; `pickDemo`
 * выбирает пример из модуля фикстур для dev-режима.
 */
export function useLoadable<T>(empty: T, pickDemo: (fixtures: Fixtures) => T): Loadable<T> {
  const [mode] = useState(demoMode);
  const [status, setStatus] = useState<LoadStatus>(() => initialStatus(mode));
  const [data, setData] = useState<T>(empty);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Ошибку показываем, пока Жилец не нажмёт «Повторить».
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
    // pickDemo — новая функция на каждый рендер, поэтому не в зависимостях:
    // перезагрузка только по «Повторить».
  }, [mode, attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((current) => current + 1);
  }, []);

  return { status, data, retry };
}
