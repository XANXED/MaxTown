import { useCallback, useEffect, useRef, useState } from 'react';

// Общий каркас для данных экранов. useLoadable — для экранов, у которых API
// ещё нет: в сборке данные пустые и готовые. useApiLoadable — данные из apps/api.
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

/** Данные из API, которые экран может заменить ответом сервера после действия. */
export type ApiLoadable<T> = Loadable<T> & {
  /** Подставить свежие данные, например карточку из ответа на действие. */
  replace: (value: T) => void;
};

/**
 * Данные экрана из apps/api. `load` — запрос; null — спрашивать нечего
 * (человек не в Доме): пусто и готово. `key` перезапускает загрузку, когда
 * меняется то, что запрашиваем. В dev `?demo=…` работает как у useLoadable:
 * примеры из fixtures.ts вместо запросов.
 */
export function useApiLoadable<T>(
  load: (() => Promise<T>) | null,
  empty: T,
  pickDemo: (fixtures: Fixtures) => T,
  key: string,
): ApiLoadable<T> {
  const [mode] = useState(demoMode);
  const [status, setStatus] = useState<LoadStatus>(() => (mode === null ? (load ? 'loading' : 'ready') : initialStatus(mode)));
  const [data, setData] = useState<T>(empty);
  const [attempt, setAttempt] = useState(0);
  // Функции-запросы новые на каждый рендер: держим последние в ref.
  const latest = useRef({ load, empty, pickDemo });
  latest.current = { load, empty, pickDemo };
  const hasLoad = load !== null;

  useEffect(() => {
    let cancelled = false;
    if (mode !== null) {
      if (mode === 'loading' || (mode === 'error' && attempt === 0)) return;
      void loadFixtures()?.then((module) => {
        if (cancelled) return;
        setData(latest.current.pickDemo(module));
        setStatus('ready');
      });
      return () => { cancelled = true; };
    }
    const request = latest.current.load;
    if (!request) {
      setData(latest.current.empty);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    request()
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [mode, attempt, key, hasLoad]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((current) => current + 1);
  }, []);
  const replace = useCallback((value: T) => setData(value), []);

  return { status, data, retry, replace };
}
