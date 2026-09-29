import type { RequestAction, RequestPlace, RequestStatus } from './index.ts';

// Правила Заявки, общие для мини-аппа и API (docs/adr/0012): клиент по ним
// решает, какие кнопки показать, сервер — что разрешить.

/** Системы Дома в порядке показа в Состоянии дома; каждая — ещё и Категория Заявки. */
export const HOUSE_SYSTEMS = ['Электричество', 'Вода', 'Отопление', 'Лифты', 'Интернет'] as const;

export type HouseSystemName = (typeof HOUSE_SYSTEMS)[number];

/** Категории без Системы (CONTEXT.md): сантехника в Квартире, домофон, уборка. */
export const CATEGORIES_WITHOUT_SYSTEM = ['Сантехника', 'Домофон', 'Уборка', 'Другое'] as const;

/** Все Категории Заявки: сначала Системы, потом остальные. */
export const REQUEST_CATEGORIES = [...HOUSE_SYSTEMS, ...CATEGORIES_WITHOUT_SYSTEM] as const;

export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export function isHouseSystem(value: string): value is HouseSystemName {
  return (HOUSE_SYSTEMS as readonly string[]).includes(value);
}

export function isRequestCategory(value: string): value is RequestCategory {
  return (REQUEST_CATEGORIES as readonly string[]).includes(value);
}

const APARTMENT: readonly RequestPlace[] = ['apartment'];
const COMMON: readonly RequestPlace[] = ['common-property'];
const BOTH: readonly RequestPlace[] = ['apartment', 'common-property'];

/**
 * Где бывает Категория. Лифты, Домофон, Уборка и Интернет — всегда Общее
 * имущество: в Квартире их не предлагаем.
 */
export const CATEGORY_PLACES: Record<RequestCategory, readonly RequestPlace[]> = {
  Электричество: BOTH,
  Вода: BOTH,
  Отопление: BOTH,
  Лифты: COMMON,
  Интернет: COMMON,
  Сантехника: BOTH,
  Домофон: COMMON,
  Уборка: COMMON,
  Другое: BOTH,
};

/** Категории, подходящие к месту неисправности, в обычном порядке. */
export function categoriesFor(place: RequestPlace): RequestCategory[] {
  return REQUEST_CATEGORIES.filter((category) => CATEGORY_PLACES[category].includes(place));
}

/**
 * Подкатегория: что именно сломалось. В форме у каждой — своя иллюстрация,
 * по которой Жилец узнаёт поломку («большая труба» — это стояк).
 */
export type RequestSubcategory = {
  /** Латиница: хранится в базе, по нему выбирается иллюстрация. */
  id: string;
  label: string;
  /** Подсказка под названием: как узнать именно этот случай. */
  hint?: string;
  places: readonly RequestPlace[];
  /** Может быть опасно: форма советует сначала позвонить в аварийную службу. */
  urgent?: boolean;
};

/** Вариант для случаев, которых нет в списке; есть в каждой Категории, кроме «Другое». */
export const OTHER_SUBCATEGORY_ID = 'other';

const other: RequestSubcategory = { id: OTHER_SUBCATEGORY_ID, label: 'Другое', hint: 'Опишите ниже, что случилось', places: BOTH };

/** Самые частые поломки в каждой Категории. У «Другое» подкатегорий нет. */
export const REQUEST_SUBCATEGORIES: Record<RequestCategory, readonly RequestSubcategory[]> = {
  Вода: [
    { id: 'riser', label: 'Течёт стояк', hint: 'Большая вертикальная труба, идёт через все этажи', places: BOTH },
    { id: 'supply', label: 'Течёт подводка', hint: 'Тонкая труба или шланг от стояка к крану', places: APARTMENT },
    { id: 'no-water', label: 'Нет воды', hint: 'Не идёт холодная или горячая', places: BOTH },
    { id: 'weak-pressure', label: 'Слабый напор', hint: 'Вода идёт тонкой струйкой', places: APARTMENT },
    { id: 'dirty-water', label: 'Ржавая или мутная вода', places: APARTMENT },
    { id: 'basement-flood', label: 'Затопило подвал', hint: 'В подвале стоит вода', places: COMMON, urgent: true },
    other,
  ],
  Сантехника: [
    { id: 'sink-clog', label: 'Засор раковины или ванны', hint: 'Вода не уходит или уходит медленно', places: APARTMENT },
    { id: 'toilet-clog', label: 'Засор унитаза', places: APARTMENT },
    { id: 'faucet-leak', label: 'Течёт смеситель или кран', places: APARTMENT },
    { id: 'toilet-leak', label: 'Течёт унитаз или бачок', places: APARTMENT },
    { id: 'sewer-clog', label: 'Засор канализации', hint: 'Общий стояк: вода поднимается у соседей снизу', places: COMMON },
    { id: 'sewer-leak', label: 'Течёт канализация в подвале', places: COMMON },
    other,
  ],
  Отопление: [
    { id: 'cold-radiator', label: 'Холодная батарея', hint: 'Остальные в Квартире тёплые', places: APARTMENT },
    { id: 'radiator-leak', label: 'Течёт батарея', places: APARTMENT },
    { id: 'heating-pipe-leak', label: 'Течёт труба отопления', hint: 'Стояк или трубы к батарее', places: BOTH },
    { id: 'cold-stairwell', label: 'Холодно в подъезде', hint: 'Не греют батареи на лестнице', places: COMMON },
    other,
  ],
  Электричество: [
    { id: 'no-power', label: 'Нет света в Квартире', places: APARTMENT },
    { id: 'socket', label: 'Не работает розетка или выключатель', places: APARTMENT },
    { id: 'sparking', label: 'Искрит или пахнет гарью', places: APARTMENT, urgent: true },
    { id: 'breaker', label: 'Выбивает автомат', hint: 'Свет гаснет, когда включаете приборы', places: APARTMENT },
    { id: 'stair-light', label: 'Не горит свет в подъезде', places: COMMON },
    { id: 'panel', label: 'Открыт или повреждён щиток', hint: 'Электрощиток на лестничной площадке', places: COMMON },
    { id: 'yard-light', label: 'Не горит фонарь у подъезда', places: COMMON },
    other,
  ],
  Лифты: [
    { id: 'lift-stopped', label: 'Лифт не работает', hint: 'Не приезжает на вызов', places: COMMON },
    { id: 'lift-doors', label: 'Двери не закрываются', places: COMMON },
    { id: 'lift-buttons', label: 'Не работают кнопки', places: COMMON },
    { id: 'lift-cabin', label: 'Грязно или темно в кабине', places: COMMON },
    other,
  ],
  Интернет: [
    { id: 'cable', label: 'Оборван кабель в подъезде', places: COMMON },
    { id: 'no-internet', label: 'Нет интернета у всего дома', hint: 'У соседей тоже не работает', places: COMMON },
    other,
  ],
  Домофон: [
    { id: 'entrance-door', label: 'Не открывается дверь подъезда', places: COMMON },
    { id: 'key', label: 'Не работает ключ', hint: 'Домофон не реагирует на ключ-таблетку', places: COMMON },
    { id: 'handset', label: 'Не звонит в Квартиру', hint: 'Трубка молчит, когда набирают номер', places: COMMON },
    { id: 'door-closer', label: 'Дверь не закрывается сама', hint: 'Сломан доводчик или замок', places: COMMON },
    other,
  ],
  Уборка: [
    { id: 'stairs-litter', label: 'Мусор на лестнице', places: COMMON },
    { id: 'bins', label: 'Переполнены баки', places: COMMON },
    { id: 'yard', label: 'Не убран двор или снег', places: COMMON },
    other,
  ],
  Другое: [],
};

/** Подкатегории Категории для места неисправности; «Другое» всегда последнее. */
export function subcategoriesFor(category: string, place: RequestPlace): RequestSubcategory[] {
  if (!isRequestCategory(category)) return [];
  return REQUEST_SUBCATEGORIES[category].filter((subcategory) => subcategory.places.includes(place));
}

/** Подкатегория по id; незнакомая (из старой версии справочника) — null. */
export function findSubcategory(category: string, id: string | null | undefined): RequestSubcategory | null {
  if (!id || !isRequestCategory(category)) return null;
  return REQUEST_SUBCATEGORIES[category].find((subcategory) => subcategory.id === id) ?? null;
}

export type RequestKindProblem = 'category_not_for_place' | 'subcategory_required' | 'subcategory_invalid';

/**
 * Подходят ли Категория и подкатегория к месту неисправности. Подкатегория
 * обязательна везде, где они есть; у «Другое» её нет.
 */
export function validateRequestKind(category: string, place: RequestPlace, subcategory: string | null | undefined): RequestKindProblem | null {
  if (!isRequestCategory(category) || !CATEGORY_PLACES[category].includes(place)) return 'category_not_for_place';
  const options = subcategoriesFor(category, place);
  if (options.length === 0) return subcategory ? 'subcategory_invalid' : null;
  if (!subcategory) return 'subcategory_required';
  return options.some((option) => option.id === subcategory) ? null : 'subcategory_invalid';
}

/** Открытая Заявка: по ней ещё работают. Открытая Заявка об Общем имуществе — проблема Дома. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['new', 'in-progress'];

export function isOpenRequest(status: RequestStatus): boolean {
  return OPEN_REQUEST_STATUSES.includes(status);
}

/**
 * Кто смотрит Заявку. Флаги, а не одна Роль: Администратор Дома может сам
 * подать Заявку и тогда он и автор, и обрабатывает её.
 */
export type RequestViewer = {
  /** Подал эту Заявку. */
  author: boolean;
  /** УК или Администратор Дома: обрабатывает Заявки. */
  processor: boolean;
};

type Transition = {
  from: readonly RequestStatus[];
  /** Новый статус; null — статус не меняется (назначение Визита). */
  to: RequestStatus | null;
  by: 'author' | 'processor';
};

const transitions: Record<RequestAction, Transition> = {
  take: { from: ['new'], to: 'in-progress', by: 'processor' },
  'schedule-visit': { from: ['in-progress'], to: null, by: 'processor' },
  complete: { from: ['in-progress'], to: 'done', by: 'processor' },
  reject: { from: ['new', 'in-progress'], to: 'rejected', by: 'processor' },
  cancel: { from: ['new', 'in-progress'], to: 'cancelled', by: 'author' },
  confirm: { from: ['done'], to: 'closed', by: 'author' },
  'not-fixed': { from: ['done'], to: 'in-progress', by: 'author' },
};

/** Порядок кнопок: сначала главное действие статуса. */
const actionOrder: readonly RequestAction[] = ['take', 'schedule-visit', 'complete', 'confirm', 'not-fixed', 'reject', 'cancel'];

/** Что тот, кто смотрит, может сделать с Заявкой сейчас. */
export function allowedRequestActions(
  request: { status: RequestStatus; place: RequestPlace },
  viewer: RequestViewer,
): RequestAction[] {
  return actionOrder.filter((action) => {
    const transition = transitions[action];
    if (!transition.from.includes(request.status)) return false;
    if (action === 'schedule-visit' && request.place !== 'apartment') return false;
    return transition.by === 'author' ? viewer.author : viewer.processor;
  });
}

/** Статус после действия; null — действие из этого статуса невозможно. */
export function nextStatus(status: RequestStatus, action: RequestAction): RequestStatus | null {
  const transition = transitions[action];
  if (!transition.from.includes(status)) return null;
  return transition.to ?? status;
}

/** «У меня тоже» ставят соседи на открытую Заявку об Общем имуществе. */
export function canSupport(request: { status: RequestStatus; place: RequestPlace }, viewer: RequestViewer): boolean {
  return request.place === 'common-property' && isOpenRequest(request.status) && !viewer.author;
}

/** Комментарии пишут автор и Ответственные, пока Заявка не закрыта и не отменена. */
export function canComment(status: RequestStatus, viewer: RequestViewer): boolean {
  return (viewer.author || viewer.processor) && status !== 'closed' && status !== 'cancelled';
}

const TITLE_LIMIT = 60;

/**
 * Заголовок Заявки из описания: первая фраза, не длиннее 60 символов,
 * обрезанная по границе слова. Отдельного поля в форме нет.
 */
export function requestTitle(description: string): string {
  const firstLine = description.trim().split(/\r?\n/u)[0] ?? '';
  // Без lookbehind: его нет в WebView старых iOS, где тоже открывают MAX.
  const firstSentence = /^(.*?[.!?…])(?:\s|$)/u.exec(firstLine)?.[1] ?? firstLine;
  const sentence = firstSentence.trim().replace(/[.,;:!?…\s]+$/u, '');
  if (!sentence) return 'Заявка';
  const capitalized = sentence[0]!.toLocaleUpperCase('ru-RU') + sentence.slice(1);
  if (capitalized.length <= TITLE_LIMIT) return capitalized;
  const cut = capitalized.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_LIMIT / 2 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/u, '')}…`;
}
