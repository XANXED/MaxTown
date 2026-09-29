import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { useHouseEvents } from './eventDetails.ts';
import { demoMode, type LoadStatus } from './loadable.ts';
import { isProcessor, useRequests } from './requests.ts';

export type HomeData = {
  status: LoadStatus;
  /** У человека есть Дом — по членству из серверной сессии; в dev-демо — всегда. */
  isResident: boolean;
  /** УК или Администратор Дома: видит все Заявки Дома и обрабатывает их. */
  processor: boolean;
  requests: RequestSummary[];
  events: HouseEventSummary[];
  retry: () => void;
};

/** Заявки и События дома из API; участие в Доме — из серверной сессии. */
export function useHomeData(): HomeData {
  const membership = useMembership();
  const requests = useRequests();
  const events = useHouseEvents();
  const demo = demoMode() !== null;
  const status: LoadStatus = requests.status === 'error' || events.status === 'error' ? 'error'
    : requests.status === 'loading' || events.status === 'loading' ? 'loading'
    : 'ready';
  return {
    status,
    isResident: demo || membership !== null,
    processor: isProcessor(membership?.role),
    requests: requests.data,
    events: events.data,
    retry: () => {
      requests.retry();
      events.retry();
    },
  };
}

/**
 * Сколько Заявок ждут этого человека: Жильца — подтверждения исправления,
 * УК и Администратора — чтобы их взяли в работу.
 */
export function waitingRequests(requests: RequestSummary[], processor: boolean): number {
  return processor
    ? requests.filter((request) => request.status === 'new').length
    : requests.filter((request) => request.status === 'done' && request.relation === 'author').length;
}
