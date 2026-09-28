import type { HouseState, HouseSystemState } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';
import { glueRanges, plural } from './text.ts';
import { useCurrentHouse } from '../houseSession.ts';

// Состояние дома: работает ли каждая Система прямо сейчас. Авария важнее
// Планового отключения — о ней говорим первой.

export type HouseSummary = {
  /** positive — всё работает, negative — Авария, attention — только Плановое отключение. */
  tone: 'positive' | 'negative' | 'attention';
  title: string;
  description: string;
};

function names(systems: HouseSystemState[]): string {
  return systems.map(({ name }) => name).join(', ');
}

/** Одна фраза о Доме для главной и шапки экрана. */
export function houseSummary(systems: HouseSystemState[]): HouseSummary {
  if (systems.length === 0) return {
    tone: 'positive', title: 'Дом подключён', description: 'Данные о системах дома ещё не добавлены',
  };
  const accidents = systems.filter(({ status }) => status === 'accident');
  const outages = systems.filter(({ status }) => status === 'planned-outage');

  if (accidents.length > 0) {
    return {
      tone: 'negative',
      title: `Авария: ${names(accidents)}`,
      description: outages.length > 0 ? `Плановое отключение: ${names(outages)}` : 'Остальные Системы работают',
    };
  }

  if (outages.length > 0) {
    return { tone: 'attention', title: `Плановое отключение: ${names(outages)}`, description: 'Остальные Системы работают' };
  }

  const next = systems.find(({ nextOutage }) => nextOutage);
  return {
    tone: 'positive',
    title: 'Всё работает',
    description: next?.nextOutage
      ? `Ближайшее Плановое отключение: ${next.name}, ${next.nextOutage.period}`
      : `Все ${systems.length} ${plural(systems.length, ['Система', 'Системы', 'Систем'])} Дома в порядке`,
  };
}

/**
 * «12–14 октября» и «с 08:40» переносятся целиком: неразрывные пробелы и
 * невидимая связка после тире (перед ним браузер тоже любит переносить).
 */
function glued(text: string): string {
  return glueRanges(text.replaceAll(' ', '\u00a0'));
}

/** Подпись под названием Системы в списке. */
export function systemStatusLine(system: HouseSystemState): string {
  const detail = system.detail ? ` ${glued(system.detail)}` : '';
  switch (system.status) {
    case 'accident':
      return `Авария${detail}`;
    case 'planned-outage':
      return `Плановое отключение${detail}`;
    default:
      return system.nextOutage ? `Работает. Отключение ${glued(system.nextOutage.period)}` : 'Работает';
  }
}

/** Сначала то, что не работает: Аварии, потом Плановые отключения, потом остальное. */
export function brokenFirst(systems: HouseSystemState[]): HouseSystemState[] {
  const rank = { accident: 0, 'planned-outage': 1, working: 2 } as const;
  return [...systems].sort((a, b) => rank[a.status] - rank[b.status]);
}

/**
 * Что сейчас известно о Системе, которую Жилец выбрал Категорией Заявки:
 * открытая Авария или идущее Плановое отключение. Работает — null.
 */
export function knownProblem(state: HouseState | null, category: string | null): HouseSystemState | null {
  if (!state || !category) return null;
  const system = state.systems.find(({ name }) => name === category);
  return system && system.status !== 'working' ? system : null;
}

/**
 * Адрес подключённого Дома получен от сервера. До появления данных о системах
 * оставляем их список пустым и не утверждаем, что всё работает.
 */
export function useHouseState(): Loadable<HouseState | null> {
  const house = useCurrentHouse();
  const result = useLoadable<HouseState | null>(null, ({ sampleHouseState }) => sampleHouseState());
  return house ? {
    ...result, status: 'ready',
    data: { address: house.houseLabel, apartment: '', systems: [], updatedAt: '' },
  } : result;
}
