// Примеры для `?demo=filled` в режиме разработки: посмотреть, как выглядят
// списки и карточки. В сборку не попадают — см. loadable.ts.
import type {
  Contact,
  HouseEventDetails,
  HouseEventSummary,
  HouseSearchResult,
  HouseState,
  InviteCheck,
  Place,
  ReadingsWindow,
  RequestDetails,
  RequestSummary,
  UserNotification,
} from '@maxtown/shared';
import buildingImage from '../assets/home-building.webp';

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
    { id: 'r5', number: 2461, category: 'Электричество', title: 'Мигает свет в подъезде', status: 'new', updatedAt: hoursAgo(1) },
    { id: 'r4', number: 2458, category: 'Сантехника', title: 'Течёт кран на кухне', status: 'in-progress', updatedAt: hoursAgo(5) },
    { id: 'r3', number: 2431, category: 'Уборка', title: 'Мусор на лестнице 3-го этажа', status: 'done', updatedAt: hoursAgo(27) },
    { id: 'r2', number: 2390, category: 'Домофон', title: 'Не открывается дверь с ключа', status: 'closed', updatedAt: hoursAgo(24 * 9) },
    { id: 'r1', number: 2344, category: 'Отопление', title: 'Холодная батарея в спальне', status: 'rejected', updatedAt: hoursAgo(24 * 20) },
  ];
}

function detailsFor(summary: RequestSummary): RequestDetails {
  const base = { ...summary, photos: [], comments: [] };
  switch (summary.id) {
    case 'r5':
      return {
        ...base,
        place: 'common-property',
        description: 'На площадке 5-го этажа второй день мигает лампа, вечером почти темно.',
        photos: [{ id: 'p1', url: buildingImage }],
        history: [{ status: 'new', at: hoursAgo(1) }],
      };
    case 'r4':
      return {
        ...base,
        place: 'apartment',
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
        place: 'common-property',
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
        place: 'apartment',
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
        place: 'apartment',
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

export const sampleEvents: HouseEventSummary[] = [
  { id: 'e4', kind: 'accident', title: 'Не работает лифт во 2-м подъезде', period: 'с 08:40' },
  { id: 'e3', kind: 'planned-outage', title: 'Отключение горячей воды', period: '12–14 октября' },
  { id: 'e2', kind: 'announcement', title: 'Собрание жильцов во дворе', period: '16 октября, 19:00' },
  { id: 'e1', kind: 'planned-outage', title: 'Отключение интернета', period: '20 октября, 10:00–16:00' },
];

function todayAt(hours: number, minutes = 0): string {
  return daysFromNow(0, hours, minutes).toISOString();
}

/** Даты примеров Плановых отключений и Объявления — октябрь 2026, как в sampleEvents. */
function october(day: number, hours: number): string {
  return new Date(2026, 9, day, hours).toISOString();
}

const eventDetails: Record<string, Omit<HouseEventDetails, keyof HouseEventSummary>> = {
  e4: {
    description: 'Лифт остановился между 5-м и 6-м этажами, внутри никого нет. Лифтовая служба уже едет.',
    startsAt: todayAt(8, 40),
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
    startsAt: october(12, 9),
    endsAt: october(14, 21),
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
    startsAt: october(16, 19),
    scope: 'Двор, у детской площадки',
    systems: [],
    advice: [],
    author: { name: 'Марина Ковалёва', role: 'Староста' },
  },
  e1: {
    description: 'Провайдер меняет оборудование в подвале Дома.',
    startsAt: october(20, 10),
    endsAt: october(20, 16),
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
      { name: 'Электричество', status: 'working' },
      { name: 'Вода', status: 'working', nextOutage: { eventId: 'e3', period: '12–14 октября' } },
      { name: 'Отопление', status: 'working' },
      { name: 'Лифты', status: 'accident', eventId: 'e4', detail: 'с 08:40' },
      { name: 'Интернет', status: 'working', nextOutage: { eventId: 'e1', period: '20 октября' } },
    ],
  };
}

export const sampleHouses: HouseSearchResult[] = [
  { id: 'h1', address: 'ул. Лесная, 12', locality: 'Казань, Советский район' },
  { id: 'h2', address: 'ул. Лесная, 14', locality: 'Казань, Советский район' },
  { id: 'h3', address: 'пр. Победы, 3', locality: 'Казань, Приволжский район' },
];

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
      id: 'n2',
      kind: 'join-approved',
      title: 'Запрос на вступление одобрен',
      text: 'Вы Жилец Квартиры 34, ул. Лесная, 12',
      at: hoursAgo(30),
      read: true,
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

export const sampleContacts: Contact[] = [
  { id: 'c1', title: 'Диспетчерская', description: 'Круглосуточно', phone: '+7 843 205-41-17', kind: 'dispatch' },
  { id: 'c2', title: 'Аварийная служба', description: 'Вода, отопление, электричество', phone: '+7 843 205-41-90', kind: 'emergency' },
  { id: 'c3', title: 'Лифтовая служба', description: 'Если застряли в лифте', phone: '+7 843 238-06-52', kind: 'emergency' },
  { id: 'c4', title: 'Участковый', description: 'Рустам Галимов, приём по вторникам 18:00–20:00', phone: '+7 917 284-63-05', kind: 'police' },
];

export const samplePlaces: Place[] = [
  { id: 'p1', title: 'Поликлиника № 7', category: 'clinic', address: 'ул. Лесная, 31', distance: 640, hours: 'Пн–пт 7:30–20:00, сб 8:00–14:00', phone: '+7 843 221-10-07' },
  { id: 'p2', title: 'МФЦ Советского района', category: 'mfc', address: 'пр. Победы, 17', distance: 1280, hours: 'Пн–сб 8:00–20:00' },
  { id: 'p3', title: 'Аптека «Здоровье»', category: 'pharmacy', address: 'ул. Лесная, 16', distance: 120, hours: 'Круглосуточно' },
  { id: 'p4', title: 'Аптека на Победы', category: 'pharmacy', address: 'пр. Победы, 5', distance: 450, hours: 'Ежедневно 8:00–22:00' },
  { id: 'p5', title: 'Школа № 142', category: 'school', address: 'ул. Сосновая, 4', distance: 530 },
  { id: 'p6', title: 'Детский сад № 51 «Берёзка»', category: 'kindergarten', address: 'ул. Лесная, 8', distance: 210 },
];

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
