import type { HouseEventDetails, HouseEventKind } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';

/** Где Событие дома во времени: ещё впереди, идёт или уже закончилось. */
export type EventPhase = 'upcoming' | 'ongoing' | 'finished';

/**
 * Авария открыта, пока её не закрыли, — даже если ожидаемое окончание прошло.
 * Плановое отключение и Объявление живут по своим датам.
 */
export function eventPhase(event: HouseEventDetails, now: Date): EventPhase {
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

/** «12 октября, 09:00». */
export function formatEventTime(iso: string): string {
  return eventTimeFormat.format(new Date(iso)).replace(' в ', ', ');
}

/** Карточка События дома. Без API — не найдено; примеры для dev — см. loadable.ts. */
export function useEventDetails(id: string): Loadable<HouseEventDetails | null> {
  return useLoadable<HouseEventDetails | null>(null, ({ sampleEventDetails }) => sampleEventDetails(id));
}
