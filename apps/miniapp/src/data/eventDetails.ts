import type { AccidentInput, AccidentUpdate, HouseEventDetails, HouseEventKind, HouseEventSummary, HousePublicationInput } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { useMembership } from '../auth/membership.tsx';
import { jsonRequest, readApiJson, type Fetcher } from './api.ts';
import { useApiLoadable, type ApiLoadable } from './loadable.ts';

/** Где Событие дома во времени: ещё впереди, идёт или уже закончилось. */
export type EventPhase = 'upcoming' | 'ongoing' | 'finished';

/**
 * Авария открыта, пока её не закрыли, — даже если ожидаемое окончание прошло.
 * Плановое отключение и Объявление живут по своим датам.
 */
export function eventPhase(event: HouseEventSummary, now: Date): EventPhase {
  if (event.resolvedAt) return 'finished';
  if (event.kind === 'accident') return 'ongoing';
  if (event.endsAt && now.getTime() > new Date(event.endsAt).getTime()) return 'finished';
  if (now.getTime() < new Date(event.startsAt).getTime()) return 'upcoming';
  return 'ongoing';
}

const phaseLabels: Partial<Record<HouseEventKind, Record<EventPhase, string>>> = {
  accident: { upcoming: 'Открыта', ongoing: 'Открыта', finished: 'Закрыта' },
  'planned-outage': { upcoming: 'Запланировано', ongoing: 'Идёт сейчас', finished: 'Закончилось' },
};

/** Подпись статуса; у Объявления его нет. */
export function eventPhaseLabel(kind: HouseEventKind, phase: EventPhase): string | null {
  return phaseLabels[kind]?.[phase] ?? null;
}

const eventTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const dayMonthFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const clockFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** «12 октября, 09:00». */
export function formatEventTime(iso: string): string {
  return eventTimeFormat.format(new Date(iso)).replace(' в ', ', ');
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** С какого времени: «с 08:40» сегодня, «с 12 октября, 08:40» раньше. */
export function formatSince(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return sameDay(date, now) ? `с ${clockFormat.format(date)}` : `с ${formatEventTime(iso)}`;
}

/** До какого дня: «до 14 октября». */
export function formatUntil(iso: string): string {
  return `до ${dayMonthFormat.format(new Date(iso))}`;
}

/**
 * Период по времени телефона: «16 октября, 19:00», «20 октября, 10:00–16:00»,
 * «12–14 октября», «30 сентября – 2 октября».
 */
export function formatRange(startsAt: string, endsAt?: string): string {
  const start = new Date(startsAt);
  const at = formatEventTime(startsAt);
  if (!endsAt) return at;
  const end = new Date(endsAt);
  if (sameDay(start, end)) return `${at}–${clockFormat.format(end)}`;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${dayMonthFormat.format(end)}`;
  }
  return `${dayMonthFormat.format(start)} – ${dayMonthFormat.format(end)}`;
}

/** Подпись периода События в списке и карточке. Открытая Авария — «с 08:40». */
export function eventPeriod(event: Pick<HouseEventSummary, 'kind' | 'startsAt' | 'endsAt' | 'resolvedAt'>, now: Date = new Date()): string {
  if (event.kind === 'accident') return event.resolvedAt ? formatRange(event.startsAt, event.resolvedAt) : formatSince(event.startsAt, now);
  return formatRange(event.startsAt, event.endsAt);
}

const errorMessages: Record<string, string> = {
  accident_already_open: 'По этой Системе уже открыта Авария',
  accident_already_resolved: 'Эту Аварию уже закрыли',
  accident_edit_forbidden: 'Аварии открывают и закрывают УК и Администратор Дома',
  event_edit_forbidden: 'События публикуют УК и Администратор Дома',
  event_invalid: 'Проверьте время, Систему и описание События',
  event_not_found: 'Событие не найдено',
  forbidden: 'Вы больше не участник этого Дома',
};

export function createEventsClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/events`;
  const read = <T,>(response: Response, fallback: string) => readApiJson<T>(response, fallback, errorMessages);
  return {
    list: async (houseId: string): Promise<HouseEventSummary[]> =>
      (await read<{ events: HouseEventSummary[] }>(await fetcher(base(houseId)), 'Не удалось загрузить События')).events,
    get: async (houseId: string, eventId: string): Promise<HouseEventDetails | null> => {
      const response = await fetcher(`${base(houseId)}/${encodeURIComponent(eventId)}`);
      if (response.status === 404) return null;
      return (await read<{ event: HouseEventDetails }>(response, 'Не удалось загрузить Событие')).event;
    },
    open: async (houseId: string, input: AccidentInput): Promise<HouseEventDetails> =>
      (await read<{ event: HouseEventDetails }>(await fetcher(base(houseId), jsonRequest('POST', input)), 'Не удалось открыть Аварию')).event,
    publish: async (houseId: string, input: HousePublicationInput): Promise<HouseEventDetails> =>
      (await read<{ event: HouseEventDetails }>(
        await fetcher(`${base(houseId)}/publications`, jsonRequest('POST', input)),
        'Не удалось опубликовать Событие',
      )).event,
    removePublication: async (houseId: string, eventId: string): Promise<void> => {
      await read<unknown>(
        await fetcher(`${base(houseId)}/${encodeURIComponent(eventId)}/publication`, jsonRequest('DELETE')),
        'Не удалось убрать Событие',
      );
    },
    resolve: async (houseId: string, eventId: string): Promise<HouseEventDetails> =>
      (await read<{ event: HouseEventDetails }>(
        await fetcher(`${base(houseId)}/${encodeURIComponent(eventId)}/resolve`, jsonRequest('POST')),
        'Не удалось закрыть Аварию',
      )).event,
    /** УК и Администратор: заголовок, статус работ, срок. */
    update: async (houseId: string, eventId: string, update: AccidentUpdate): Promise<HouseEventDetails> =>
      (await read<{ event: HouseEventDetails }>(
        await fetcher(`${base(houseId)}/${encodeURIComponent(eventId)}`, jsonRequest('PATCH', update)),
        'Не удалось сохранить Аварию',
      )).event,
    /** «У меня тоже» на Аварии: поставить или снять. */
    confirm: async (houseId: string, eventId: string, confirmed: boolean): Promise<HouseEventDetails> =>
      (await read<{ event: HouseEventDetails }>(
        await fetcher(`${base(houseId)}/${encodeURIComponent(eventId)}/confirm`, jsonRequest(confirmed ? 'POST' : 'DELETE')),
        'Не удалось сохранить отметку',
      )).event,
  };
}

export const eventsClient = createEventsClient();

/** События дома: открытые Аварии и закрытые за неделю. Примеры для dev — см. loadable.ts. */
export function useHouseEvents(): ApiLoadable<HouseEventSummary[]> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable(houseId ? () => eventsClient.list(houseId) : null, [], ({ sampleEvents }) => sampleEvents, houseId ?? '');
}

/** Карточка События дома. Не найдено — null. */
export function useEventDetails(id: string): ApiLoadable<HouseEventDetails | null> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable<HouseEventDetails | null>(
    houseId ? () => eventsClient.get(houseId, id) : null,
    null,
    ({ sampleEventDetails }) => sampleEventDetails(id),
    `${houseId ?? ''}:${id}`,
  );
}
