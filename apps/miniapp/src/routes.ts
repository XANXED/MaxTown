export const ROUTES = {
  welcome: '/welcome',
  home: '/',
  requests: '/requests',
  newRequest: '/requests/new',
  events: '/events',
  services: '/services',
  profile: '/profile',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

const validRoutes = new Set<AppRoute>(Object.values(ROUTES));

export function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#/, '') || ROUTES.home;
  return validRoutes.has(candidate as AppRoute) ? (candidate as AppRoute) : ROUTES.home;
}

export function hashForRoute(route: AppRoute): string {
  return `#${route}`;
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
