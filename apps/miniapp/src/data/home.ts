import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { demoMode, useLoadable, type LoadStatus } from './loadable.ts';

export type HomeData = {
  status: LoadStatus;
  /** У человека есть Дом — по членству из серверной сессии; в dev-демо — всегда. */
  isResident: boolean;
  requests: RequestSummary[];
  events: HouseEventSummary[];
  retry: () => void;
};

type HomeContent = Pick<HomeData, 'isResident' | 'requests' | 'events'>;

const empty: HomeContent = { isResident: false, requests: [], events: [] };

/**
 * Участие в Доме берём из серверной сессии. Заявки и События пока пустые;
 * их будущий API подключается отдельно. Примеры для dev — см. loadable.ts.
 */
export function useHomeData(): HomeData {
  const { status, data, retry } = useLoadable(empty, ({ sampleRequests, sampleEvents }) => ({
    isResident: true,
    requests: sampleRequests(),
    events: sampleEvents,
  }));
  const membership = useMembership();
  // Заявок и Событий в API ещё нет, но в Доме человек или нет — известно из сессии.
  return { status, retry, ...data, isResident: demoMode() ? data.isResident : membership !== null };
}
