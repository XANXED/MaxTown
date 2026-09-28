import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';
import { useLoadable, type LoadStatus } from './loadable.ts';
import { useCurrentHouse } from '../houseSession.ts';

export type HomeData = {
  status: LoadStatus;
  /** Сервер подтвердил участие человека в Домовом чате. */
  isResident: boolean;
  requests: RequestSummary[];
  events: HouseEventSummary[];
  retry: () => void;
};

type HomeContent = Pick<HomeData, 'isResident' | 'requests' | 'events'>;

const empty: HomeContent = { isResident: false, requests: [], events: [] };

/**
 * Участие в Доме берём из серверной авторизации. Заявки и События пока пустые;
 * их будущий API подключается отдельно. Примеры для dev — см. loadable.ts.
 */
export function useHomeData(): HomeData {
  const house = useCurrentHouse();
  const { status, data, retry } = useLoadable(empty, ({ sampleRequests, sampleEvents }) => ({
    isResident: true,
    requests: sampleRequests(),
    events: sampleEvents,
  }));
  return { status, retry, ...data, isResident: Boolean(house) || data.isResident };
}
