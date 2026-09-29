import type { RequestStatus, RequestSummary } from '@maxtown/shared';
import { plural } from './text.ts';

export type RequestFilter = 'all' | 'active' | 'closed' | 'new' | 'in-progress';

export const requestFilterLabels: Record<RequestFilter, string> = {
  all: 'Все',
  active: 'Активные',
  closed: 'Закрытые',
  new: 'Новые',
  'in-progress': 'В работе',
};

/** Жилец следит за своими Заявками; УК и Администратор разбирают новые и ведут начатые. */
export function requestFiltersFor(processor: boolean): RequestFilter[] {
  return processor ? ['new', 'in-progress', 'all'] : ['all', 'active', 'closed'];
}

const emptyFilterTexts: Record<RequestFilter, string> = {
  all: 'Заявок нет.',
  active: 'Активных Заявок нет: всё исправлено.',
  closed: 'Закрытых Заявок пока нет.',
  new: 'Новых Заявок нет: все разобраны.',
  'in-progress': 'В работе сейчас ничего нет.',
};

export function emptyFilterText(filter: RequestFilter): string {
  return emptyFilterTexts[filter];
}

/** Активные — по которым ещё что-то произойдёт; Выполненная ждёт ответа Жильца. */
const activeStatuses = new Set<RequestStatus>(['new', 'in-progress', 'done']);

export function isActiveRequest(request: RequestSummary): boolean {
  return activeStatuses.has(request.status);
}

export function filterRequests(requests: RequestSummary[], filter: RequestFilter): RequestSummary[] {
  if (filter === 'all') return requests;
  if (filter === 'new' || filter === 'in-progress') return requests.filter((request) => request.status === filter);
  return requests.filter((request) => isActiveRequest(request) === (filter === 'active'));
}

/** «5 Заявок», «5 Заявок, 1 ждёт подтверждения». */
export function requestsSummary(requests: RequestSummary[]): string {
  const total = `${requests.length} ${plural(requests.length, ['Заявка', 'Заявки', 'Заявок'])}`;
  const awaiting = requests.filter((request) => request.status === 'done').length;
  if (awaiting === 0) return total;
  return `${total}, ${awaiting} ${plural(awaiting, ['ждёт', 'ждут', 'ждут'])} подтверждения`;
}
