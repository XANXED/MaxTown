// Примеры для `?demo=filled` в режиме разработки: посмотреть, как выглядят
// списки и карточки. В сборку не попадают — см. loadable.ts.
import type {
  HouseContact,
  HouseEventDetails,
  HouseEventSummary,
  HouseState,
  InviteCheck,
  AssignedPlace,
  NearestPlace,
  NearestPlaceKind,
  ReadingsWindow,
  RequestDetails,
  RequestSummary,
  UserNotification,
  HouseInternetProvider,
} from '@maxtown/shared';
import buildingImage from '../assets/home-building.webp';

export const sampleInternetProviders: HouseInternetProvider[] = [
  {
    id: 'internet-1', name: 'ДомСвязь', availability: 'available', phone: '+7 800 555-01-01', link: 'https://example.org/connect',
    note: 'Подключение обычно занимает 2–3 рабочих дня.', updatedAt: '2026-09-28T09:00:00.000Z', source: 'manual', sourceExternalId: null, sourceCheckedAt: null, manualOverride: true,
    rating: { average: 4.3, count: 12, myScore: 4 },
    tariffs: [
      { id: 'tariff-1', name: 'Дом 500', speedMbps: 500, monthlyPrice: '750.00', promoPrice: '500.00', promoMonths: 3, technology: 'fttb', hasTv: false, conditions: 'Роутер оплачивается отдельно', source: 'https://example.org/tariffs', checkedOn: '2026-09-20' },
      { id: 'tariff-2', name: 'Дом 800 + ТВ', speedMbps: 800, monthlyPrice: '990.00', promoPrice: null, promoMonths: null, technology: 'gpon', hasTv: true, conditions: 'ТВ-приставка включена', source: 'https://example.org/tariffs', checkedOn: '2026-09-20' },
    ],
  },
  {
    id: 'internet-2', name: 'Город Онлайн', availability: 'limited', phone: null, link: 'https://example.com/check', note: null,
    updatedAt: '2026-09-22T09:00:00.000Z', source: 'manual', sourceExternalId: null, sourceCheckedAt: null, manualOverride: true, rating: { average: 3.5, count: 2, myScore: null },
    tariffs: [{ id: 'tariff-3', name: 'Старт', speedMbps: 200, monthlyPrice: '600.00', promoPrice: null, promoMonths: null, technology: 'fttb', hasTv: false, conditions: '', source: 'https://example.com/tariffs', checkedOn: '2026-09-22' }],
  },
];

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** Через сколько-то дней в hh:mm местного времени. */
function daysFromNow(days: number, hours: number, minutes = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function sampleRequests(): RequestSummary[] {
  return [
    { id: 'r5', number: 2461, category: 'Электричество', subcategory: 'stair-light', title: 'Мигает свет в подъезде', status: 'new', place: 'common-property', supportCount: 2, relation: 'author', updatedAt: hoursAgo(1) },
    { id: 'r4', number: 2458, category: 'Сантехника', subcategory: 'faucet-leak', title: 'Течёт кран на кухне', status: 'in-progress', place: 'apartment', supportCount: 0, relation: 'author', updatedAt: hoursAgo(5) },
    { id: 'r3', number: 2431, category: 'Уборка', subcategory: 'stairs-litter', title: 'Мусор на лестнице 3-го этажа', status: 'done', place: 'common-property', supportCount: 0, relation: 'author', updatedAt: hoursAgo(27) },
    { id: 'r2', number: 2390, category: 'Домофон', subcategory: 'entrance-door', title: 'Не открывается дверь с ключа', status: 'closed', place: 'apartment', supportCount: 0, relation: 'author', updatedAt: hoursAgo(24 * 9) },
    { id: 'r1', number: 2344, category: 'Отопление', subcategory: 'cold-radiator', title: 'Холодная батарея в спальне', status: 'rejected', place: 'apartment', supportCount: 0, relation: 'author', updatedAt: hoursAgo(24 * 20) },
  ];
}

/** Действия автора по статусу — как их считает сервер (packages/shared/src/requests.ts). */
function authorActions(summary: RequestSummary): Pick<RequestDetails, 'actions' | 'canSupport' | 'supportedByMe' | 'canComment'> {
  const actions: RequestDetails['actions'] = summary.status === 'done' ? ['confirm', 'not-fixed']
    : summary.status === 'new' || summary.status === 'in-progress' ? ['cancel'] : [];
  return { actions, canSupport: false, supportedByMe: false, canComment: summary.status !== 'closed' && summary.status !== 'cancelled' };
}

function detailsFor(summary: RequestSummary): RequestDetails {
  const base = { ...summary, ...authorActions(summary), photos: [], comments: [] };
  switch (summary.id) {
    case 'r5':
      return {
        ...base,
        description: 'На площадке 5-го этажа второй день мигает лампа, вечером почти темно.',
        photos: [{ id: 'p1', url: buildingImage }],
        history: [{ status: 'new', at: hoursAgo(1) }],
      };
    case 'r4':
      return {
        ...base,
        apartment: '34',
        description: 'Из-под смесителя на кухне капает вода, подставили таз.',
        responsibleName: 'Сергей Лукин',
        visit: { preferredDate: isoDay(daysFromNow(1, 0)), scheduledAt: daysFromNow(1, 10, 30).toISOString() },
        history: [
          { status: 'new', at: hoursAgo(26) },
          { status: 'in-progress', at: hoursAgo(5), note: 'Ответственный: Сергей Лукин' },
        ],
        comments: [
          {
            id: 'c1',
            authorName: 'Сергей Лукин',
            authorRole: 'responsible',
            mine: false,
            text: 'Добрый день. Приду завтра в 10:30, перекройте, пожалуйста, воду под раковиной.',
            at: hoursAgo(5),
          },
          { id: 'c2', authorName: 'Вы', authorRole: 'resident', mine: true, text: 'Хорошо, буду дома.', at: hoursAgo(4) },
        ],
      };
    case 'r3':
      return {
        ...base,
        description: 'После ремонта в 34-й квартире на лестнице оставили мешки со строительным мусором.',
        responsibleName: 'Ольга Нестерова',
        history: [
          { status: 'new', at: hoursAgo(50) },
          { status: 'in-progress', at: hoursAgo(40), note: 'Ответственный: Ольга Нестерова' },
          { status: 'done', at: hoursAgo(27) },
        ],
        comments: [
          {
            id: 'c3',
            authorName: 'Ольга Нестерова',
            authorRole: 'responsible',
            mine: false,
            text: 'Мешки вывезли, площадку помыли. Проверьте, пожалуйста.',
            at: hoursAgo(27),
          },
        ],
      };
    case 'r2':
      return {
        ...base,
        apartment: '34',
        description: 'Ключ прикладываю — домофон пищит, но дверь подъезда не открывается.',
        responsibleName: 'Андрей Галиев',
        visit: { preferredDate: isoDay(daysFromNow(-10, 0)), scheduledAt: daysFromNow(-10, 18).toISOString() },
        history: [
          { status: 'new', at: hoursAgo(24 * 11) },
          { status: 'in-progress', at: hoursAgo(24 * 11 - 3), note: 'Ответственный: Андрей Галиев' },
          { status: 'done', at: hoursAgo(24 * 10) },
          { status: 'closed', at: hoursAgo(24 * 9) },
        ],
      };
    default:
      return {
        ...base,
        apartment: '34',
        description: 'В спальне батарея ледяная, в остальных комнатах тёплые.',
        history: [
          { status: 'new', at: hoursAgo(24 * 21) },
          {
            status: 'rejected',
            at: hoursAgo(24 * 20),
            note: 'Отопительный сезон начнётся 1 октября, батареи включат по графику',
          },
        ],
      };
  }
}

export function sampleRequestDetails(id: string): RequestDetails | null {
  const summary = sampleRequests().find((request) => request.id === id);
  return summary ? detailsFor(summary) : null;
}

function todayAt(hours: number, minutes = 0): string {
  return daysFromNow(0, hours, minutes).toISOString();
}

/** Даты примеров Плановых отключений и Объявления — октябрь 2026. */
function october(day: number, hours: number): string {
  return new Date(2026, 9, day, hours).toISOString();
}

export const sampleEvents: HouseEventSummary[] = [
  { id: 'e4', kind: 'accident', title: 'Не работает лифт во 2-м подъезде', startsAt: todayAt(8, 40), endsAt: daysFromNow(1, 18).toISOString() },
  { id: 'e3', kind: 'planned-outage', title: 'Отключение горячей воды', startsAt: october(12, 9), endsAt: october(14, 21) },
  { id: 'e2', kind: 'announcement', title: 'Собрание жильцов во дворе', startsAt: october(16, 19) },
  { id: 'e1', kind: 'planned-outage', title: 'Отключение интернета', startsAt: october(20, 10), endsAt: october(20, 16) },
];

/** Режим ЧС в примере: аварийные работы, срок уже переносили. */
const sampleEmergency = {
  workStatus: 'repairing' as const,
  confirmedApartments: 12,
  deadlineRevised: true,
  confirmedByMe: false,
  canConfirm: true,
  canWithdraw: false,
};

const eventDetails: Record<string, Omit<HouseEventDetails, keyof HouseEventSummary>> = {
  e4: {
    emergency: sampleEmergency,
    description: 'Лифт остановился между 5-м и 6-м этажами, внутри никого нет. Лифтовая служба уже едет.',
    scope: '2-й подъезд',
    systems: ['Лифты'],
    advice: [
      'Лифт в 1-м подъезде работает',
      'Если кто-то застрял в лифте, звоните в аварийную службу',
    ],
    linkedRequests: 4,
  },
  e3: {
    description: 'Горячей воды не будет: плановая промывка труб перед отопительным сезоном.',
    scope: 'Весь Дом',
    systems: ['Вода'],
    advice: [
      'Холодная вода будет, отключают только горячую',
      'Наберите горячую воду заранее, если она понадобится',
      'Если 14 октября после 21:00 воды всё ещё нет, подайте Заявку',
    ],
    author: { name: 'Ольга Нестерова', role: 'Ответственный' },
  },
  e2: {
    description: 'Обсудим замену лифта во 2-м подъезде и график уборки лестниц. Нужен кворум, приходите.',
    scope: 'Двор, у детской площадки',
    systems: [],
    advice: [],
    author: { name: 'Марина Ковалёва', role: 'Администратор Дома' },
  },
  e1: {
    description: 'Провайдер меняет оборудование в подвале Дома.',
    scope: 'Весь Дом',
    systems: ['Интернет'],
    advice: ['Мобильный интернет будет работать', 'Скачайте нужное заранее'],
    author: { name: 'Ольга Нестерова', role: 'Ответственный' },
  },
};

export function sampleEventDetails(id: string): HouseEventDetails | null {
  const summary = sampleEvents.find((event) => event.id === id);
  const details = eventDetails[id];
  return summary && details ? { ...summary, ...details } : null;
}

export function sampleHouseState(): HouseState {
  return {
    address: 'ул. Лесная, 12',
    apartment: '34',
    updatedAt: hoursAgo(0.2),
    systems: [
      { name: 'Электричество', status: 'reported', requestId: 'r5', since: hoursAgo(1) },
      { name: 'Вода', status: 'working', nextOutage: { eventId: 'e3', startsAt: october(12, 9), endsAt: october(14, 21) } },
      { name: 'Отопление', status: 'working' },
      { name: 'Лифты', status: 'accident', eventId: 'e4', since: todayAt(8, 40) },
      { name: 'Интернет', status: 'working', nextOutage: { eventId: 'e1', startsAt: october(20, 10), endsAt: october(20, 16) } },
    ],
    emergencies: [{
      id: 'e4',
      title: 'Не работает лифт во 2-м подъезде',
      system: 'Лифты',
      openedAt: todayAt(8, 40),
      expectedResolutionAt: daysFromNow(1, 18).toISOString(),
      ...sampleEmergency,
    }],
    problems: sampleRequests().filter((request) => request.place === 'common-property' && request.status === 'new'),
  };
}

export function sampleNotifications(): UserNotification[] {
  return [
    {
      id: 'n5',
      kind: 'request-status',
      title: 'Заявка № 2431 выполнена',
      text: 'Проверьте и подтвердите исправление',
      at: hoursAgo(0.5),
      read: false,
      requestId: 'r3',
    },
    {
      id: 'n4',
      kind: 'request-comment',
      title: 'Комментарий в Заявке № 2458',
      text: 'Сергей Лукин: Приду завтра в 10:30, перекройте, пожалуйста, воду под раковиной.',
      at: hoursAgo(5),
      read: false,
      requestId: 'r4',
    },
    {
      id: 'n3',
      kind: 'request-visit',
      title: 'Назначен Визит по Заявке № 2458',
      text: 'Завтра, 10:30',
      at: hoursAgo(5.1),
      read: true,
      requestId: 'r4',
    },
    {
      id: 'n1',
      kind: 'request-status',
      title: 'Заявка № 2344 отклонена',
      text: 'Отопительный сезон начнётся 1 октября, батареи включат по графику',
      at: hoursAgo(24 * 20),
      read: true,
      requestId: 'r1',
    },
  ];
}

export const sampleContacts: HouseContact[] = [
  { id: 'c0', title: 'Управляющая организация', description: 'ООО «Наш дом»', phone: '+7 495 000-00-00', kind: 'management', source: 'data-mos', sourceCheckedAt: '2026-09-28T09:00:00.000Z', overridden: false, updatedAt: '2026-09-28T09:00:00.000Z' },
  { id: 'c1', title: 'Диспетчерская', description: 'Круглосуточно', phone: '+7 843 205-41-17', kind: 'dispatch', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T10:00:00.000Z' },
  { id: 'c5', title: 'Дежурный диспетчер', description: 'По вопросам общедомовых работ', phone: '+7 843 205-41-18', kind: 'dispatch', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T10:00:00.000Z' },
  { id: 'c2', title: 'Аварийная служба', description: 'Вода, отопление, электричество', phone: '+7 843 205-41-90', kind: 'house-emergency', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T10:00:00.000Z' },
  { id: 'c3', title: 'Лифтовая служба', description: 'Если застряли в лифте', phone: '+7 843 238-06-52', kind: 'elevator', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T10:00:00.000Z' },
  { id: 'c4', title: 'Участковый', description: 'Рустам Галимов, приём по вторникам 18:00–20:00', phone: '+7 917 284-63-05', kind: 'district-police', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T10:00:00.000Z' },
];

/** Точка демо-Дома: ул. Лесная, 12 в Казани. */
export const sampleHousePoint = { lat: 55.752, lon: 49.213 };

/** Закреплённые места демо-Дома: их внёс Администратор Дома, он же поставил точки. */
export const sampleAssignedPlaces: AssignedPlace[] = [
  { id: 'a1', kind: 'adult-clinic', title: 'Поликлиника № 7', address: 'ул. Лесная, 31', hours: 'Пн–пт 7:30–20:00, сб 8:00–14:00', phone: '+7 843 221-10-07', note: 'Прикрепление — в регистратуре, 1 этаж', point: { lat: 55.7531, lon: 49.2159 }, updatedAt: '2026-09-20T09:00:00.000Z' },
  { id: 'a2', kind: 'children-clinic', title: 'Детская поликлиника № 10', address: 'просп. Победы, 56', hours: 'Пн–пт 8:00–19:00', point: { lat: 55.7508, lon: 49.2126 }, updatedAt: '2026-09-20T09:00:00.000Z' },
  { id: 'a3', kind: 'school', title: 'Гимназия № 21', address: 'ул. Рихарда Зорге, 71', note: 'Дом закреплён за гимназией: приоритет при записи в 1 класс', point: { lat: 55.7497, lon: 49.216 }, updatedAt: '2026-09-20T09:00:00.000Z' },
  { id: 'a4', kind: 'polling-station', title: 'Избирательный участок № 1712', address: 'ул. Рихарда Зорге, 71, актовый зал', point: { lat: 55.7497, lon: 49.2161 }, updatedAt: '2026-09-20T09:00:00.000Z' },
  { id: 'a5', kind: 'police-precinct', title: 'Участковый пункт полиции', address: 'ул. Лесная, 18', hours: 'Вт 18:00–20:00', note: 'Участковый Рустам Галимов', point: { lat: 55.7524, lon: 49.2138 }, updatedAt: '2026-09-20T09:00:00.000Z' },
];

/** Ближайшие места для демо: в жизни их отдаёт 2ГИС и они не хранятся. */
export function sampleNearestPlaces(kind: NearestPlaceKind): NearestPlace[] {
  const samples: Partial<Record<NearestPlaceKind, NearestPlace[]>> = {
    trauma: [
      { id: 'n1', title: 'Травматологическое отделение', address: 'Камышовая улица, 50 к1', point: { lat: 55.7601, lon: 49.2311 }, distance: 2789, open24x7: true, hoursToday: 'Круглосуточно', url: 'https://2gis.ru/firm/1' },
      { id: 'n2', title: 'Медицентр, платный травмпункт', address: 'аллея Поликарпова, 6 к2', point: { lat: 55.7466, lon: 49.2244 }, distance: 2038, open24x7: false, hoursToday: '9:00–21:00', url: 'https://2gis.ru/firm/2' },
    ],
    'pharmacy-24': [
      { id: 'n3', title: 'Озерки, аптека', address: 'Комендантский проспект, 13 к1', point: { lat: 55.7534, lon: 49.2168 }, distance: 450, open24x7: true, hoursToday: 'Круглосуточно', url: 'https://2gis.ru/firm/3' },
      { id: 'n4', title: 'Столички, социальная аптека', address: 'улица Шаврова, 5', point: { lat: 55.7489, lon: 49.2103 }, distance: 592, open24x7: true, hoursToday: 'Круглосуточно', url: 'https://2gis.ru/firm/4' },
    ],
    mfc: [
      { id: 'n5', title: 'Мои документы', address: 'улица Ильюшина, 14', addressComment: '3 этаж', point: { lat: 55.7552, lon: 49.2201 }, distance: 865, open24x7: false, hoursToday: '9:30–21:00', url: 'https://2gis.ru/firm/5' },
    ],
  };
  return (samples[kind] ?? []).sort((a, b) => a.distance - b.distance);
}

export function sampleReadingsWindow(): ReadingsWindow {
  return {
    from: isoDay(daysFromNow(-10, 0)),
    to: isoDay(daysFromNow(3, 0)),
    apartment: 'Квартира 34',
    meters: [
      { id: 'm1', kind: 'cold-water', title: 'Холодная вода, кухня', unit: 'м³', serial: '04521873', decimals: 3, previous: { value: 123.456, at: isoDay(daysFromNow(-35, 0)) } },
      { id: 'm2', kind: 'hot-water', title: 'Горячая вода, кухня', unit: 'м³', serial: '04521911', decimals: 3, previous: { value: 81.203, at: isoDay(daysFromNow(-35, 0)) } },
      { id: 'm3', kind: 'electricity-day', title: 'Электричество, день', unit: 'кВт·ч', serial: '1187 5530', decimals: 1, previous: { value: 4521.3, at: isoDay(daysFromNow(-35, 0)) } },
      { id: 'm4', kind: 'electricity-night', title: 'Электричество, ночь', unit: 'кВт·ч', serial: '1187 5530', decimals: 1, previous: { value: 1874.6, at: isoDay(daysFromNow(-35, 0)) } },
    ],
  };
}

/** Проверка Приглашения в демо: код с «old» — перевыпущено, с «none» — не найдено. */
export async function sampleInviteCheck(code: string): Promise<InviteCheck> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (code.includes('old')) return { status: 'revoked' };
  if (code.includes('none')) return { status: 'not-found' };
  return { status: 'valid', houseAddress: 'ул. Лесная, 12', apartment: '34' };
}
