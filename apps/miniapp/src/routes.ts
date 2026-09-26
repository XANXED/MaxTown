export const ROUTES = {
  welcome: '/welcome',
  home: '/',
  requests: '/requests',
  newRequest: '/requests/new',
  events: '/events',
  services: '/services',
  profile: '/profile',
  house: '/house',
  join: '/join',
  notifications: '/notifications',
  contacts: '/contacts',
  places: '/places',
  readings: '/readings',
} as const;

export type StaticRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Карточки открываются по id: `/requests/2458`, `/events/e4`. */
export type AppRoute = StaticRoute | `/requests/${string}` | `/events/${string}`;

const staticRoutes = new Set<string>(Object.values(ROUTES));

/** id карточки: буквы, цифры, дефис и подчёркивание — без слешей и пробелов. */
const cardPattern = /^\/(requests|events)\/([\w-]+)$/;

export function requestRoute(id: string): AppRoute {
  return `/requests/${id}`;
}

export function eventRoute(id: string): AppRoute {
  return `/events/${id}`;
}

/** Карточка Заявки или События дома, если маршрут на неё указывает. */
export function matchCard(route: AppRoute): { kind: 'request' | 'event'; id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, list, id] = cardPattern.exec(route) ?? [];
  if (!id) return null;
  return { kind: list === 'requests' ? 'request' : 'event', id };
}

export function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#/, '') || ROUTES.home;
  if (staticRoutes.has(candidate) || cardPattern.test(candidate)) return candidate as AppRoute;
  return ROUTES.home;
}

export function hashForRoute(route: AppRoute): string {
  return `#${route}`;
}

/** Корневые экраны: приветствие и вкладки нижней навигации. «Назад» на них не нужен. */
const rootRoutes = new Set<AppRoute>([ROUTES.welcome, ROUTES.home, ROUTES.requests, ROUTES.services, ROUTES.profile]);

export function isRootRoute(route: AppRoute): boolean {
  return rootRoutes.has(route);
}

const parents: Partial<Record<StaticRoute, AppRoute>> = {
  [ROUTES.newRequest]: ROUTES.requests,
  [ROUTES.contacts]: ROUTES.services,
  [ROUTES.places]: ROUTES.services,
};

/**
 * Куда ведёт «Назад», если истории внутри приложения нет — например, экран
 * открыли по ссылке из Уведомления бота. Карточка возвращает к своему списку.
 */
export function parentRoute(route: AppRoute): AppRoute {
  const card = matchCard(route);
  if (card) return card.kind === 'request' ? ROUTES.requests : ROUTES.events;
  return parents[route as StaticRoute] ?? ROUTES.home;
}

/**
 * Экран при запуске. MAX кладёт данные запуска во фрагмент адреса
 * (`#WebAppData=…`), поэтому непустой хеш ещё не значит, что экран выбран.
 * Если хеш не называет экран и приветствие не видели — начинаем с него.
 */
export function startRoute(hash: string, seenWelcome: boolean): AppRoute {
  const route = routeFromHash(hash);
  const namesScreen = hashForRoute(route) === hash;
  if (!namesScreen && !seenWelcome) return ROUTES.welcome;
  return route;
}
