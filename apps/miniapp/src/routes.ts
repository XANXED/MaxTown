import type { NearestPlaceKind } from '@maxtown/shared';
import { NEAREST_PLACE_KINDS } from '@maxtown/shared';

export const ROUTES = {
  welcome: '/welcome',
  home: '/',
  requests: '/requests',
  newRequest: '/requests/new',
  events: '/events',
  newAccident: '/events/new',
  services: '/services',
  profile: '/profile',
  house: '/house',
  join: '/join',
  notifications: '/notifications',
  contacts: '/contacts',
  newContact: '/contacts/new',
  places: '/places',
  newPlace: '/places/new',
  readings: '/readings',
  utilities: '/utilities',
  utilitiesReadings: '/utilities/readings',
  community: '/community',
  repairMode: '/repair-mode',
  internet: '/internet',
  newInternetProvider: '/internet/new',
  managementQuestions: '/management-questions',
  newManagementQuestion: '/management-questions/new',
} as const;

export type StaticRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** Карточки открываются по id: `/requests/2458`, `/events/e4`. */
export type AppRoute =
  | StaticRoute
  | `/requests/${string}`
  | `/events/${string}`
  | `/repair-mode/${string}`
  | `/management-questions/${string}`
  | `/utilities/payments/${string}`
  | `/contacts/${string}/edit`
  | `/internet/${string}/edit`
  | `/places/${string}/edit`
  | `/places/nearest/${string}`;

const staticRoutes = new Set<string>(Object.values(ROUTES));

/** id карточки: буквы, цифры, дефис и подчёркивание — без слешей и пробелов. */
const cardPattern = /^\/(requests|events)\/([\w-]+)$/;
const contactEditorPattern = /^\/contacts\/([\w-]+)\/edit$/;
const internetProviderEditorPattern = /^\/internet\/([\w-]+)\/edit$/;
const placeEditorPattern = /^\/places\/([\w-]+)\/edit$/;
const nearestPattern = /^\/places\/nearest\/([\w-]+)$/;
const repairPattern = /^\/repair-mode\/([\w-]+)$/;
const managementQuestionPattern = /^\/management-questions\/([\w-]+)$/;
const utilityPaymentPattern = /^\/utilities\/payments\/([\w-]+)$/;

export function requestRoute(id: string): AppRoute {
  return `/requests/${id}`;
}

export function eventRoute(id: string): AppRoute {
  return `/events/${id}`;
}

export function repairRoute(id: string): AppRoute {
  return `/repair-mode/${id}`;
}

export function matchRepair(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = repairPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function managementQuestionRoute(id: string): AppRoute {
  return `/management-questions/${id}`;
}

export function utilityPaymentRoute(id: string): AppRoute {
  return `/utilities/payments/${id}`;
}

export function matchUtilityPayment(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = utilityPaymentPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function matchManagementQuestion(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = managementQuestionPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function contactEditRoute(id: string): AppRoute {
  return `/contacts/${id}/edit`;
}

export function matchContactEditor(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = contactEditorPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function internetProviderEditRoute(id: string): AppRoute {
  return `/internet/${id}/edit`;
}

export function matchInternetProviderEditor(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = internetProviderEditorPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function placeEditRoute(id: string): AppRoute {
  return `/places/${id}/edit`;
}

export function matchPlaceEditor(route: AppRoute): { id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, id] = placeEditorPattern.exec(route) ?? [];
  return id ? { id } : null;
}

export function nearestPlacesRoute(kind: NearestPlaceKind): AppRoute {
  return `/places/nearest/${kind}`;
}

/** Ближайшие места одного Вида; незнакомый Вид — не маршрут. */
export function matchNearestPlaces(route: AppRoute): { kind: NearestPlaceKind } | null {
  const [, kind] = nearestPattern.exec(route) ?? [];
  return kind && (NEAREST_PLACE_KINDS as readonly string[]).includes(kind) ? { kind: kind as NearestPlaceKind } : null;
}

/** Карточка Заявки или События дома, если маршрут на неё указывает. */
export function matchCard(route: AppRoute): { kind: 'request' | 'event'; id: string } | null {
  if (staticRoutes.has(route)) return null;
  const [, list, id] = cardPattern.exec(route) ?? [];
  if (!id) return null;
  return { kind: list === 'requests' ? 'request' : 'event', id };
}

export function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#/, '').split('&')[0] || ROUTES.home;
  if (staticRoutes.has(candidate) || cardPattern.test(candidate) || repairPattern.test(candidate) || managementQuestionPattern.test(candidate) || utilityPaymentPattern.test(candidate) || contactEditorPattern.test(candidate) || internetProviderEditorPattern.test(candidate)) return candidate as AppRoute;
  if (placeEditorPattern.test(candidate) || matchNearestPlaces(candidate as AppRoute)) return candidate as AppRoute;
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
  [ROUTES.newAccident]: ROUTES.house,
  [ROUTES.contacts]: ROUTES.services,
  [ROUTES.newContact]: ROUTES.contacts,
  [ROUTES.places]: ROUTES.services,
  [ROUTES.newPlace]: ROUTES.places,
  [ROUTES.repairMode]: ROUTES.services,
  [ROUTES.internet]: ROUTES.services,
  [ROUTES.newInternetProvider]: ROUTES.internet,
  [ROUTES.managementQuestions]: ROUTES.services,
  [ROUTES.newManagementQuestion]: ROUTES.managementQuestions,
  [ROUTES.utilities]: ROUTES.services,
  [ROUTES.utilitiesReadings]: ROUTES.utilities,
  [ROUTES.readings]: ROUTES.utilities,
};

/**
 * Куда ведёт «Назад», если истории внутри приложения нет — например, экран
 * открыли по ссылке из Уведомления бота. Карточка возвращает к своему списку.
 */
export function parentRoute(route: AppRoute): AppRoute {
  if (matchRepair(route)) return ROUTES.repairMode;
  if (matchManagementQuestion(route)) return ROUTES.managementQuestions;
  if (matchUtilityPayment(route)) return ROUTES.utilities;
  if (matchContactEditor(route)) return ROUTES.contacts;
  if (matchInternetProviderEditor(route)) return ROUTES.internet;
  if (matchPlaceEditor(route) || matchNearestPlaces(route)) return ROUTES.places;
  const card = matchCard(route);
  if (card) return card.kind === 'request' ? ROUTES.requests : ROUTES.events;
  return parents[route as StaticRoute] ?? ROUTES.home;
}

/**
 * MAX передаёт параметры запуска отдельно от hash-маршрута, поэтому пустой hash
 * при первом запуске не выбирает экран.
 * Если хеш не называет экран и приветствие не видели — начинаем с него.
 */
export function startRoute(hash: string, seenWelcome: boolean): AppRoute {
  const route = routeFromHash(hash);
  const namesScreen = hashForRoute(route) === hash.split('&')[0];
  if (!namesScreen && !seenWelcome) return ROUTES.welcome;
  return route;
}
