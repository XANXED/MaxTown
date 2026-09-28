// Контракты, общие для фронтендов и бэкенда. Доменные типы (заявки, статусы дома)
// появятся здесь по мере того, как их зафиксирует CONTEXT.md.

export type HealthResponse = {
  status: 'ok';
};

/**
 * Состояние Заявки по CONTEXT.md: новая, в работе, Выполненная (ждёт подтверждения
 * Жильца), Закрытая, Отклонённая Ответственным, Отменённая самим Жильцом.
 */
export type RequestStatus = 'new' | 'in-progress' | 'done' | 'closed' | 'rejected' | 'cancelled';

/** Строка Заявки в списке. */
export type RequestSummary = {
  id: string;
  number: number;
  category: string;
  title: string;
  status: RequestStatus;
  /** ISO 8601. */
  updatedAt: string;
};

/** Где неисправность: в своей Квартире или в Общем имуществе. */
export type RequestPlace = 'apartment' | 'common-property';

/** Шаг истории Заявки: смена статуса. */
export type RequestStatusChange = {
  status: RequestStatus;
  /** ISO 8601. */
  at: string;
  /** Пояснение: кто взял в работу, причина отказа, ответ Жильца. */
  note?: string;
};

/** Визит по Заявке в Квартире: день выбирает Жилец, время назначает Ответственный. */
export type RequestVisit = {
  /** День, удобный Жильцу: YYYY-MM-DD. */
  preferredDate: string;
  /** Время, которое назначил Ответственный, ISO 8601; пока не назначил — нет. */
  scheduledAt?: string;
};

/** Комментарий в Заявке от Жильца или Ответственного. */
export type RequestComment = {
  id: string;
  authorName: string;
  authorRole: 'resident' | 'responsible';
  /** Комментарий написал тот, кто смотрит Заявку. */
  mine: boolean;
  text: string;
  /** ISO 8601. */
  at: string;
};

export type RequestPhoto = {
  id: string;
  url: string;
};

/** Карточка Заявки целиком. */
export type RequestDetails = RequestSummary & {
  description: string;
  place: RequestPlace;
  /** Ответственный, который взял Заявку; пока никто не взял — нет. */
  responsibleName?: string;
  visit?: RequestVisit;
  photos: RequestPhoto[];
  /** От старых шагов к новым; последний совпадает со status. */
  history: RequestStatusChange[];
  comments: RequestComment[];
  /** Авария, к которой привязана Заявка: закроется Авария — закроется и Заявка. */
  accidentId?: string;
};

/** Событие дома: Авария, Плановое отключение или Объявление. */
export type HouseEventKind = 'accident' | 'planned-outage' | 'announcement';

/** Строка События дома в списке. */
export type HouseEventSummary = {
  id: string;
  kind: HouseEventKind;
  title: string;
  /** Готовая подпись периода или времени: «12–14 октября», «с 08:40». */
  period: string;
};

/** Кто опубликовал Событие дома. */
export type HouseEventAuthor = {
  name: string;
  /** Роль в Доме: «Староста», «Ответственный», «Консьерж». */
  role: string;
};

/** Карточка События дома целиком. */
export type HouseEventDetails = HouseEventSummary & {
  description: string;
  /** ISO 8601: начало; у Аварии — когда её открыли. */
  startsAt: string;
  /** ISO 8601: окончание; у Аварии — ожидаемое, пока не известно — нет. */
  endsAt?: string;
  /** ISO 8601: Авария закрыта. */
  resolvedAt?: string;
  /** Где в Доме: «2-й подъезд», «весь Дом», «двор». */
  scope?: string;
  /** Затронутые Системы — названия, как в Состоянии дома. */
  systems: string[];
  /** Что делать Жильцу, по пункту на строку. */
  advice: string[];
  author?: HouseEventAuthor;
  /** Для Аварии: сколько Заявок к ней привязано. */
  linkedRequests?: number;
};

/** Работает ли Система сейчас: работает, Авария или Плановое отключение. */
export type HouseSystemStatus = 'working' | 'accident' | 'planned-outage';

/** Одна Система в Состоянии дома. */
export type HouseSystemState = {
  /** Название Системы: «Электричество», «Вода»… */
  name: string;
  status: HouseSystemStatus;
  /** Событие дома, из-за которого Система не работает. */
  eventId?: string;
  /** Готовая подпись времени: «с 08:40», «до 14 октября». */
  detail?: string;
  /** Ближайшее Плановое отключение, пока Система работает. */
  nextOutage?: { eventId: string; period: string };
};

/** Состояние дома: сводка по каждой Системе. */
export type HouseState = {
  /** Адрес Дома для подписи: «ул. Лесная, 12». */
  address: string;
  /** Квартира, в которой человек Жилец: «34». */
  apartment: string;
  systems: HouseSystemState[];
  /** ISO 8601. */
  updatedAt: string;
};

/** Дом в поиске для Запроса на вступление. */
export type HouseSearchResult = {
  id: string;
  /** «ул. Лесная, 12». */
  address: string;
  /** Город или район — чтобы отличить одинаковые адреса. */
  locality: string;
};

/** Что показала проверка Приглашения. */
export type InviteCheck =
  | { status: 'valid'; houseAddress: string; apartment: string }
  /** Приглашение перевыпустили — действует только новое. */
  | { status: 'revoked' }
  | { status: 'not-found' };

/**
 * Уведомление: что изменилось в Заявке человека или в его Запросе на
 * вступление. Не путать с Событием дома — то видят все Жильцы.
 */
export type UserNotification = {
  id: string;
  /** Что именно изменилось — от этого зависит значок. */
  kind: 'request-status' | 'request-comment' | 'request-visit' | 'join-approved' | 'join-declined' | 'community-poll';
  /** Готовая строка: «Заявка № 2431 выполнена». */
  title: string;
  /** Подробность: текст Комментария, время Визита. */
  text?: string;
  /** ISO 8601. */
  at: string;
  read: boolean;
  /** Заявка, которую открывает Уведомление; у Запроса на вступление нет. */
  requestId?: string;
  /** Дом и Опрос для перехода из уведомления. */
  houseId?: string;
  pollId?: string;
};

export type HouseContactKind =
  | 'management'
  | 'dispatch'
  | 'house-emergency'
  | 'plumber'
  | 'electrician'
  | 'elevator'
  | 'intercom'
  | 'security'
  | 'district-police'
  | 'other';

export type ContactKind = HouseContactKind | 'emergency';

/** Контакт: телефон или ссылка службы, полезной Жильцам Дома. Список ведёт Староста. */
export type Contact = {
  id: string;
  /** «Диспетчерская», «Сантехник», «Участковый». */
  title: string;
  /** Часы работы, имя, пояснение. */
  description?: string;
  /** Номер для показа: «+7 843 555-12-34». */
  phone?: string;
  link?: string;
  kind: ContactKind;
};

export type HouseContact = Contact & {
  kind: HouseContactKind;
  source: 'manual' | 'data-mos';
  sourceCheckedAt: string | null;
  overridden: boolean;
  updatedAt: string;
};

export type HouseContactImportStatus =
  | 'ready'
  | 'not-found'
  | 'ambiguous'
  | 'failed'
  | 'not-configured'
  | 'not-applicable';

export type HouseContactsResponse = {
  contacts: HouseContact[];
  importState: {
    status: HouseContactImportStatus;
    checkedAt: string | null;
  };
};

export type HouseContactInput = {
  kind: HouseContactKind;
  title: string;
  description: string | null;
  phone: string | null;
  link: string | null;
};

/** Тариф Услуги дома с явно указанными источником и датой проверки. */
export type HouseServiceTariff = {
  id: string;
  amount: string;
  currency: string;
  billingPeriod: string;
  conditions: string;
  startsOn: string;
  endsOn: string | null;
  source: string;
  checkedOn: string;
};

/** Услуга конкретного Дома и Поставщик, который её оказывает. */
export type HouseService = {
  id: string;
  category: 'internet' | 'telecom' | 'utilities' | 'maintenance' | 'other';
  provider: string;
  title: string;
  state: 'available' | 'limited' | 'unavailable' | 'discontinued';
  contacts: { phone?: string; link?: string; details?: string };
  note: string | null;
  updatedAt: string;
  tariffs: HouseServiceTariff[];
};

/** Технология подключения домашнего интернета, если Поставщик её сообщил. */
export type InternetTechnology = 'fttb' | 'gpon' | 'docsis' | 'xdsl' | 'wireless' | 'other';

/** Откуда пришли сведения о Поставщике. Пока интерфейс создаёт только manual. */
export type InternetProviderSource = 'manual' | 'partner-feed' | 'operator-api' | 'gis-zhkh';

export type InternetProviderSyncStatus = 'not-configured' | 'ready' | 'running' | 'failed';

/** Тариф интернет-Поставщика, проверенный для конкретного Дома. */
export type InternetTariff = {
  id: string;
  name: string;
  speedMbps: number | null;
  monthlyPrice: string;
  promoPrice: string | null;
  promoMonths: number | null;
  technology: InternetTechnology | null;
  hasTv: boolean;
  conditions: string;
  source: string;
  checkedOn: string;
};

export type HouseInternetProviderRating = {
  average: number | null;
  count: number;
  myScore: number | null;
};

/** Поставщик домашнего интернета с доступностью и рейтингом только этого Дома. */
export type HouseInternetProvider = {
  id: string;
  name: string;
  availability: 'available' | 'limited';
  phone: string | null;
  link: string | null;
  note: string | null;
  updatedAt: string;
  source: InternetProviderSource;
  sourceExternalId: string | null;
  sourceCheckedAt: string | null;
  manualOverride: boolean;
  tariffs: InternetTariff[];
  rating: HouseInternetProviderRating;
};

export type HouseInternetProviderImportState = {
  status: InternetProviderSyncStatus;
  source: InternetProviderSource | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
};

export type HouseInternetProvidersResponse = {
  providers: HouseInternetProvider[];
  importState: HouseInternetProviderImportState;
};

export type InternetTariffInput = Omit<InternetTariff, 'id'>;

export type HouseInternetProviderInput = {
  name: string;
  availability: HouseInternetProvider['availability'];
  phone: string | null;
  link: string | null;
  note: string | null;
  tariffs: InternetTariffInput[];
};

/** Точка на карте, градусы WGS 84. */
export type GeoPoint = {
  lat: number;
  lon: number;
};

/**
 * Вид Закреплённого места (CONTEXT.md): за ним Дом закреплён по адресу, и
 * «ближайшее» тут не подходит — нужно «своё».
 */
export type AssignedPlaceKind =
  | 'adult-clinic'
  | 'children-clinic'
  | 'womens-clinic'
  | 'school'
  | 'kindergarten'
  | 'polling-station'
  | 'magistrate'
  | 'police-precinct'
  | 'military-office'
  | 'other';

/** Закреплённое место: хранится у нас, список ведёт Староста. */
export type AssignedPlace = {
  id: string;
  kind: AssignedPlaceKind;
  title: string;
  address: string;
  /** «Пн–пт 8:00–20:00». */
  hours?: string;
  phone?: string;
  /** Пояснение Старосты: «кабинет 12», «приём по вторникам». */
  note?: string;
  /** Точка, которую Староста поставил на карте; без неё места нет на карте. */
  point?: GeoPoint;
  /** ISO 8601. */
  updatedAt: string;
};

export type AssignedPlaceInput = {
  kind: AssignedPlaceKind;
  title: string;
  address: string;
  hours: string | null;
  phone: string | null;
  note: string | null;
  point: GeoPoint | null;
};

/**
 * Вид Ближайшего места (CONTEXT.md). Такие места ищутся в 2ГИС вокруг Дома
 * при каждом открытии и не хранятся (docs/adr/0003).
 */
export type NearestPlaceKind =
  | 'trauma'
  | 'emergency-room'
  | 'pharmacy-24'
  | 'vet-24'
  | 'mfc'
  | 'social-services'
  | 'social-fund'
  | 'tax'
  | 'registry-office'
  | 'batteries';

export const NEAREST_PLACE_KINDS: readonly NearestPlaceKind[] = [
  'trauma',
  'emergency-room',
  'pharmacy-24',
  'vet-24',
  'mfc',
  'social-services',
  'social-fund',
  'tax',
  'registry-office',
  'batteries',
];

/** Ближайшее место из 2ГИС, как его отдаёт наш API. */
export type NearestPlace = {
  /** id организации в 2ГИС. */
  id: string;
  title: string;
  address?: string;
  /** «3 этаж», «вход со двора». */
  addressComment?: string;
  point: GeoPoint;
  /** Метров от Дома по прямой. */
  distance: number;
  open24x7: boolean;
  /** Часы на сегодня: «9:30–21:00»; null — сегодня не работает; нет поля — часы неизвестны. */
  hoursToday?: string | null;
  /** Карточка организации в 2ГИС. */
  url: string;
};

export type NearestPlacesResponse = {
  kind: NearestPlaceKind;
  /** Точка Дома — центр поиска и карты. */
  house: GeoPoint;
  places: NearestPlace[];
};

/** Где Дом на карте: для карты Закреплённых мест и выбора точки. */
export type HouseLocationResponse = { house: GeoPoint };

/** Прибор учёта Квартиры, с которого Жилец передаёт Показания. */
export type Meter = {
  id: string;
  kind: 'cold-water' | 'hot-water' | 'electricity-day' | 'electricity-night' | 'heat';
  /** «Холодная вода, кухня». */
  title: string;
  /** «м³», «кВт·ч», «Гкал». */
  unit: string;
  /** Заводской номер, чтобы не перепутать приборы. */
  serial?: string;
  /** Сколько цифр после запятой на приборе. */
  decimals: number;
  /** Прошлые Показания — от них считается расход. */
  previous?: { value: number; at: string };
};

/** Приём Показаний в этом месяце. */
export type ReadingsWindow = {
  /** YYYY-MM-DD, включительно. */
  from: string;
  to: string;
  /** «Квартира 34». */
  apartment: string;
  meters: Meter[];
};

/** Где регистрация Дома: ждёт Модератора, одобрена или отклонена. */
export type HouseRegistrationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Регистрация Дома Старостой. Модератор проверяет её, прежде чем Дом начнёт
 * работать (CONTEXT.md). Адрес приходит из подсказок DaData, GUID — из ГАР
 * (docs/research/2026-09-house-data-and-max-platform.md, 4.5).
 */
export type HouseRegistration = {
  id: string;
  /** «ул. Лесная, 12». */
  address: string;
  /** «Казань, Советский район». */
  locality: string;
  /** GUID дома в ГАР; нет — адреса нет в реестре (новостройка), сверять вручную. */
  garHouseGuid?: string;
  /** Кто зарегистрировал: будущий Староста. Имя и ник — из VK. */
  headman: {
    name: string;
    vkUsername?: string;
    /** Телефон, который Староста передал при регистрации. */
    phone?: string;
    /** Квартира Старосты в этом Доме. */
    apartment: string;
  };
  /** ISO 8601. */
  submittedAt: string;
  status: HouseRegistrationStatus;
  /** ISO 8601: когда Модератор решил. */
  decidedAt?: string;
  /** Причина отказа — её увидит Староста. */
  rejectionReason?: string;
};

/** Роль человека в конкретном Доме. */
export type HouseRole = 'headman' | 'responsible' | 'concierge' | 'resident';

/** Активная связь Жильца с Домом, которую возвращает авторизованная сессия. */
export type HouseMembershipSummary = {
  id: string;
  houseId: string;
  apartmentId: string | null;
  apartmentNumber: string | null;
  address: string;
  locality: string;
  role: HouseRole;
};

/** Проверенные данные человека из текущей серверной сессии. */
export type AuthResident = {
  id: string;
  vkUserId: string | null;
  displayName: string;
  username: string | null;
  phone: string | null;
  phoneVerified: boolean;
};

export type AuthSessionResponse = {
  token: string;
  expiresAt: string;
};

/** Сообщение в отдельном Домовом сообществе; это не Комментарий к Заявке. */
export type CommunityMessage = {
  id: string;
  authorName: string;
  authorRole: HouseRole;
  body: string;
  createdAt: string;
};

export type CommunityPollOption = { id: string; label: string; votes: number };

/** Неформальный Опрос Жильцов, не заменяющий собрание собственников. */
export type CommunityPoll = {
  id: string;
  question: string;
  createdAt: string;
  closesAt: string | null;
  options: CommunityPollOption[];
  myVoteOptionId: string | null;
};

export type CommunityPollResults = {
  pollId: string;
  question: string;
  totalVotes: number;
  options: CommunityPollOption[];
  myVoteOptionId: string | null;
};

/** Текущий объявленный режим ремонта в Доме и автор последнего изменения. */
export type RepairMode = {
  isActive: boolean;
  title: string | null;
  description: string | null;
  startsAt: string | null;
  expectedCompletionAt: string | null;
  instructions: string | null;
  updatedAt: string | null;
  updatedBy: { displayName: string; role: HouseRole } | null;
};

export type MeResponse = {
  resident: AuthResident;
  memberships: HouseMembershipSummary[];
};
