import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';
import { useLoadable, type LoadStatus } from './loadable.ts';

export type HomeData = {
  status: LoadStatus;
  /** Человек — Жилец хотя бы одной Квартиры. Без API всегда false, в dev-демо — true. */
  isResident: boolean;
  requests: RequestSummary[];
  events: HouseEventSummary[];
  retry: () => void;
};

type HomeContent = Pick<HomeData, 'isResident' | 'requests' | 'events'>;

const empty: HomeContent = { isResident: false, requests: [], events: [] };

/**
 * Данные главной и списков Заявок и Событий дома. API ещё нет, поэтому пока всегда пусто; запрос к
 * apps/api появится здесь. Примеры для dev — см. loadable.ts.
 */
export function useHomeData(): HomeData {
  const { status, data, retry } = useLoadable(empty, ({ sampleRequests, sampleEvents }) => ({
    isResident: true,
    requests: sampleRequests(),
    events: sampleEvents,
  }));
  return { status, retry, ...data };
}
