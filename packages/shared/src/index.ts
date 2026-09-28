// Контракты, общие для фронтендов и бэкенда. Доменные типы (заявки, статусы дома)
// появятся здесь по мере того, как их зафиксирует CONTEXT.md.

export type HealthResponse = {
  status: 'ok';
};

/** Роли внутри Дома для хакатона. */
export type HouseRole = 'admin' | 'resident' | 'management-company';

/** Подтверждённая сервером личность из подписанного initData MAX. */
export type MaxAuthUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
};

/** Положение человека в Домовом чате, из которого выводится Роль в Доме. */
export type MaxHouseChatRole = 'member' | 'administrator' | 'owner';

/** Доступ к общим данным Дома, подтверждённый текущим участием в Домовом чате. */
export type HouseAccess = {
  houseId: string;
  /** Точный адрес Дома из подсказки DaData. */
  houseLabel: string;
  maxChatRole: MaxHouseChatRole;
  /** Администратор Дома может назначить аккаунт УК и управлять Домом. */
  canManageHouse: boolean;
  /** Привязка к Квартире пока не реализована. */
  apartment: null;
  /** Роли актуальны только для этого Дома. */
  roles: HouseRole[];
};

/** Подключение Домового чата, для которого администратору нужно выбрать точный адрес. */
export type PendingHouseSetup = {
  chatId: number;
  chatTitle: string;
};

/** Один адрес дома из ГАР, предложенный DaData. */
export type HouseAddressSuggestion = {
  value: string;
  locality: string;
  garHouseGuid: string;
};

export type HouseAddressSuggestionsResponse = {
  suggestions: HouseAddressSuggestion[];
};

export type MaxAuthResponse = {
  user: MaxAuthUser;
  houses: HouseAccess[];
  /** Видны только администратору или владельцу соответствующего чата. */
  pendingHouseSetups: PendingHouseSetup[];
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
  /** Роль в Доме: «Администратор Дома» или «УК». */
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

/** Что показала проверка Приглашения. */
export type InviteCheck =
  | { status: 'valid'; houseAddress: string; apartment: string }
  /** Приглашение перевыпустили — действует только новое. */
  | { status: 'revoked' }
  | { status: 'not-found' };

/**
 * Уведомление: что изменилось в Заявке человека. Не путать с Событием дома —
 * то видят все Жильцы.
 */
export type UserNotification = {
  id: string;
  /** Что именно изменилось — от этого зависит значок. */
  kind: 'request-status' | 'request-comment' | 'request-visit';
  /** Готовая строка: «Заявка № 2431 выполнена». */
  title: string;
  /** Подробность: текст Комментария, время Визита. */
  text?: string;
  /** ISO 8601. */
  at: string;
  read: boolean;
  /** Заявка, которую открывает Уведомление. */
  requestId?: string;
};

/** Контакт: телефон или ссылка службы, полезной Жильцам Дома. Список ведёт Администратор Дома. */
export type Contact = {
  id: string;
  /** «Диспетчерская», «Аварийная служба», «Участковый». */
  title: string;
  /** Часы работы, имя, пояснение. */
  description?: string;
  /** Номер для показа: «+7 843 555-12-34». */
  phone?: string;
  link?: string;
  kind: 'dispatch' | 'emergency' | 'police' | 'other';
};

/** Место рядом: организация поблизости от Дома. */
export type Place = {
  id: string;
  title: string;
  category: 'clinic' | 'mfc' | 'pharmacy' | 'school' | 'kindergarten' | 'other';
  address: string;
  /** Метров от Дома по прямой. */
  distance: number;
  /** «Пн–пт 8:00–20:00». */
  hours?: string;
  phone?: string;
};

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
  /** Кто зарегистрировал: будущий Староста. Имя и ник — из MAX. */
  headman: {
    name: string;
    maxUsername?: string;
    /** Телефон, подтверждённый через MAX; нет — не подтверждал. */
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
