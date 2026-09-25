import { useEffect, useState } from 'react';
import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';

export type HomeData = {
  status: 'loading' | 'ready';
  /** Человек — Жилец хотя бы одной Квартиры. Пока вступить нельзя, всегда false. */
  isResident: boolean;
  requests: RequestSummary[];
  events: HouseEventSummary[];
};

/**
 * Как стать Жильцом: по Приглашению (QR-код или ссылка) в свою Квартиру —
 * его выдаёт Староста или Жилец этой Квартиры. Запрос на вступление появится
 * вместе с API.
 */
export const JOIN_HINT = 'Попросите Приглашение в свою Квартиру у Старосты или у Жильца этой Квартиры';

const empty: HomeData = { status: 'ready', isResident: false, requests: [], events: [] };

/**
 * Данные главной и списков Заявок и Событий дома. API ещё нет, поэтому пока всегда пусто; запрос к
 * apps/api появится здесь.
 *
 * Только при `npm run dev`: `?demo=loading` показывает скелетоны,
 * `?demo=filled` — списки с примерами. В сборку это не попадает.
 */
export function useHomeData(): HomeData {
  const [data, setData] = useState<HomeData>(() =>
    import.meta.env.DEV && demoMode() === 'loading' ? { ...empty, status: 'loading' } : empty,
  );

  useEffect(() => {
    if (!import.meta.env.DEV || demoMode() !== 'filled') return;
    let cancelled = false;
    void import('./fixtures.ts').then(({ sampleRequests, sampleEvents }) => {
      if (!cancelled) setData({ ...empty, requests: sampleRequests(), events: sampleEvents });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

function demoMode(): string | null {
  return new URLSearchParams(window.location.search).get('demo');
}
