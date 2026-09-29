import type {
  AccidentEmergency,
  AccidentWorkStatus,
  HouseEmergency,
  HouseEventDetails,
  HouseState,
  HouseStateResponse,
  HouseSystemState,
  RequestSummary,
} from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { useMembership } from '../auth/membership.tsx';
import { readApiJson, type Fetcher } from './api.ts';
import { formatEventTime, formatRange, formatSince, formatUntil } from './eventDetails.ts';
import { useApiLoadable, type ApiLoadable } from './loadable.ts';
import { glueRanges, plural } from './text.ts';

// Состояние дома: работает ли каждая Система прямо сейчас и о каких проблемах
// в Общем имуществе сообщили Жильцы. Авария важнее проблемы Дома, проблема —
// важнее Планового отключения (docs/adr/0012).

export type HouseSummary = {
  /**
   * positive — всё работает, negative — Авария, reported — Жильцы сообщили о
   * проблеме в Общем имуществе, attention — только Плановое отключение.
   */
  tone: 'positive' | 'negative' | 'reported' | 'attention';
  title: string;
  description: string;
};

function names(systems: HouseSystemState[]): string {
  return systems.map(({ name }) => name).join(', ');
}

function problemsWord(count: number): string {
  return plural(count, ['проблеме', 'проблемах', 'проблемах']);
}

/** Как идёт работа над проблемами Дома: одной строкой. */
function problemsProgress(problems: RequestSummary[]): string {
  if (problems.length === 1) {
    return problems[0]!.status === 'in-progress' ? 'В работе у Ответственного' : 'Ждёт Ответственного';
  }
  const inWork = problems.filter(({ status }) => status === 'in-progress').length;
  if (inWork === 0) return 'Ждут Ответственного';
  if (inWork === problems.length) return 'Все в работе у Ответственного';
  return `В работе: ${inWork}, ждут Ответственного: ${problems.length - inWork}`;
}

// Режим ЧС (docs/adr/0012): при открытой Аварии говорим, что случилось, что
// с работами и когда устранят, — а не «N человек пожаловались».

const workStatusLabels: Record<AccidentWorkStatus, string> = {
  checking: 'выясняют причину',
  repairing: 'аварийные работы',
};

/** «Статус: аварийные работы». */
export function workStatusLabel(status: AccidentWorkStatus): string {
  return workStatusLabels[status];
}

/** «Подтвердили проблему: 38 квартир». Число и слово не разрываются переносом. */
export function apartmentsCount(count: number): string {
  return `${count}\u00a0${plural(count, ['квартира', 'квартиры', 'квартир'])}`;
}

/** Срок устранения: «Новый срок: до 12 октября, 18:00» или «Срок: уточняется». */
export function emergencyDeadline(
  emergency: Pick<AccidentEmergency, 'deadlineRevised'> & { expectedResolutionAt?: string },
): { label: string; value: string } {
  if (!emergency.expectedResolutionAt) return { label: 'Срок', value: 'уточняется' };
  return { label: emergency.deadlineRevised ? 'Новый срок' : 'Срок', value: `до ${formatEventTime(emergency.expectedResolutionAt)}` };
}

/** Что показывает панель ЧС: Авария из Состояния дома или из своей карточки. */
export type EmergencyView = AccidentEmergency & Pick<HouseEmergency, 'title' | 'system' | 'expectedResolutionAt'>;

/** Панель ЧС из карточки Аварии. Закрытая Авария и другие События — null. */
export function eventEmergency(event: HouseEventDetails): EmergencyView | null {
  if (event.kind !== 'accident' || event.resolvedAt || !event.emergency) return null;
  return {
    ...event.emergency,
    title: event.title,
    system: event.systems[0] ?? '',
    ...(event.endsAt ? { expectedResolutionAt: event.endsAt } : {}),
  };
}

/**
 * Состояние дома после действия с Аварией: панель берёт свежие цифры из
 * ответа сервера, закрытая Авария уходит из режима ЧС.
 */
export function withEmergencyUpdate<T extends Pick<HouseStateResponse, 'emergencies'>>(state: T, event: HouseEventDetails): T {
  const fresh = eventEmergency(event);
  if (!fresh) return { ...state, emergencies: state.emergencies.filter(({ id }) => id !== event.id) };
  return {
    ...state,
    emergencies: state.emergencies.map((item) => {
      if (item.id !== event.id) return item;
      // Срок могли снять: старый не должен пережить свежий ответ.
      const { expectedResolutionAt: _stale, ...rest } = item;
      return { ...rest, ...fresh };
    }),
  };
}

/** Одна строка о работах для главной: «Аварийные работы, до 12 октября, 18:00». */
function emergencyLine(emergency: HouseEmergency): string {
  const status = workStatusLabel(emergency.workStatus);
  const deadline = emergencyDeadline(emergency);
  return `${status[0]!.toLocaleUpperCase('ru-RU')}${status.slice(1)}, ${deadline.value === 'уточняется' ? 'срок уточняется' : glued(deadline.value)}`;
}

/** Одна фраза о Доме для главной и шапки экрана. */
export function houseSummary(
  systems: HouseSystemState[],
  problems: RequestSummary[] = [],
  emergencies: HouseEmergency[] = [],
): HouseSummary {
  if (systems.length === 0 && problems.length === 0 && emergencies.length === 0) return {
    tone: 'positive', title: 'Дом подключён', description: 'Данные о системах дома ещё не добавлены',
  };
  const accidents = systems.filter(({ status }) => status === 'accident');
  const outages = systems.filter(({ status }) => status === 'planned-outage');

  if (emergencies.length > 0) {
    const [first] = emergencies;
    return {
      tone: 'negative',
      title: emergencies.length === 1 ? first!.title : `Аварии: ${emergencies.map(({ title }) => title).join(', ')}`,
      description: emergencies.length === 1 ? emergencyLine(first!) : 'Подробности — в Состоянии дома',
    };
  }

  if (accidents.length > 0) {
    return {
      tone: 'negative',
      title: `Авария: ${names(accidents)}`,
      description: problems.length > 0
        ? `Жильцы сообщили ещё о ${problems.length} ${problemsWord(problems.length)}`
        : outages.length > 0 ? `Плановое отключение: ${names(outages)}` : 'Остальные Системы работают',
    };
  }

  if (problems.length > 0) {
    return {
      tone: 'reported',
      title: problems.length === 1
        ? `Сообщили о проблеме: ${problems[0]!.title}`
        : `Жильцы сообщили о ${problems.length} ${problemsWord(problems.length)}`,
      description: problemsProgress(problems),
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
      ? `Ближайшее Плановое отключение: ${next.name}, ${formatRange(next.nextOutage.startsAt, next.nextOutage.endsAt)}`
      : `Все ${systems.length} ${plural(systems.length, ['Система', 'Системы', 'Систем'])} Дома в порядке`,
  };
}

/**
 * «12–14 октября» и «с 08:40» переносятся целиком: неразрывные пробелы и
 * невидимая связка после тире (перед ним браузер тоже любит переносить).
 */
function glued(text: string): string {
  return glueRanges(text.replaceAll(' ', ' '));
}

/** Подпись под названием Системы в списке. */
export function systemStatusLine(system: HouseSystemState, now: Date = new Date()): string {
  switch (system.status) {
    case 'accident':
      return system.since ? `Авария ${glued(formatSince(system.since, now))}` : 'Авария';
    case 'planned-outage':
      return system.until ? `Плановое отключение ${glued(formatUntil(system.until))}` : 'Плановое отключение';
    case 'reported':
      return 'Сообщили о неполадке';
    default:
      return system.nextOutage
        ? `Работает. Отключение ${glued(formatRange(system.nextOutage.startsAt, system.nextOutage.endsAt))}`
        : 'Работает';
  }
}

/** Сначала то, что не работает: Аварии, проблемы Дома, Плановые отключения, потом остальное. */
export function brokenFirst(systems: HouseSystemState[]): HouseSystemState[] {
  const rank = { accident: 0, reported: 1, 'planned-outage': 2, working: 3 } as const;
  return [...systems].sort((a, b) => rank[a.status] - rank[b.status]);
}

/**
 * Что сейчас известно о Системе, которую Жилец выбрал Категорией Заявки:
 * открытая Авария или идущее Плановое отключение. Иначе — null.
 */
export function knownProblem(state: Pick<HouseState, 'systems'> | null, category: string | null): HouseSystemState | null {
  if (!state || !category) return null;
  const system = state.systems.find(({ name }) => name === category);
  return system && (system.status === 'accident' || system.status === 'planned-outage') ? system : null;
}

/**
 * Проблема Дома, о которой уже сообщили соседи: вместо дубля — «У меня тоже».
 * Совпадать должны Категория и подкатегория: «Двери не закрываются» — не то
 * же самое, что «Лифт не работает».
 */
export function reportedProblem(
  state: Pick<HouseState, 'problems'> | null,
  category: string | null,
  subcategory: string | null = null,
): RequestSummary | null {
  if (!state || !category) return null;
  return state.problems.find((problem) => problem.category === category
    && problem.subcategory === subcategory
    && problem.relation !== 'author') ?? null;
}

export function createHouseStateClient(fetcher: Fetcher = apiFetch) {
  return {
    load: async (houseId: string): Promise<HouseStateResponse> =>
      (await readApiJson<{ state: HouseStateResponse }>(
        await fetcher(`/api/houses/${encodeURIComponent(houseId)}/state`),
        'Не удалось загрузить Состояние дома',
      )).state,
  };
}

export const houseStateClient = createHouseStateClient();

/** Состояние Дома человека: Системы и проблемы Дома из API. Примеры для dev — см. loadable.ts. */
export function useHouseState(): ApiLoadable<HouseState | null> {
  const membership = useMembership();
  const result = useApiLoadable<HouseStateResponse | null>(
    membership ? () => houseStateClient.load(membership.houseId) : null,
    null,
    ({ sampleHouseState }) => sampleHouseState(),
    membership?.houseId ?? '',
  );
  const state = result.data;
  const data: HouseState | null = state
    ? {
      ...state,
      address: 'address' in state && typeof state.address === 'string' ? state.address : membership?.address ?? '',
      apartment: 'apartment' in state && typeof state.apartment === 'string' ? state.apartment : membership?.apartmentNumber ?? '',
    }
    : null;
  return { ...result, data };
}
