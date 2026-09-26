import { describe, expect, it } from 'vitest';
import {
  eventRoute,
  hashForRoute,
  isRootRoute,
  matchCard,
  parentRoute,
  requestRoute,
  routeFromHash,
  ROUTES,
  startRoute,
} from './routes.ts';

describe('miniapp routes', () => {
  it('opens the home screen for an empty hash', () => {
    expect(routeFromHash('')).toBe(ROUTES.home);
  });

  it('parses every supported screen hash', () => {
    for (const route of Object.values(ROUTES)) {
      expect(routeFromHash(hashForRoute(route))).toBe(route);
    }
  });

  it('falls back to home for an unknown route', () => {
    expect(routeFromHash('#/missing')).toBe(ROUTES.home);
  });

  it('opens request and event cards by id', () => {
    expect(routeFromHash('#/requests/2458')).toBe('/requests/2458');
    expect(matchCard(routeFromHash('#/requests/2458'))).toEqual({ kind: 'request', id: '2458' });
    expect(matchCard(routeFromHash('#/events/hot-water'))).toEqual({ kind: 'event', id: 'hot-water' });
    expect(matchCard(requestRoute('r4'))).toEqual({ kind: 'request', id: 'r4' });
    expect(matchCard(eventRoute('e1'))).toEqual({ kind: 'event', id: 'e1' });
  });

  it('keeps the new request form a screen, not a card', () => {
    expect(routeFromHash('#/requests/new')).toBe(ROUTES.newRequest);
    expect(matchCard(ROUTES.newRequest)).toBeNull();
  });

  it('rejects malformed card ids', () => {
    expect(routeFromHash('#/requests/')).toBe(ROUTES.home);
    expect(routeFromHash('#/requests/a/b')).toBe(ROUTES.home);
    expect(routeFromHash('#/events/%20x')).toBe(ROUTES.home);
  });
});

describe('back navigation', () => {
  it('treats the bottom tabs and welcome as roots', () => {
    expect(isRootRoute(ROUTES.home)).toBe(true);
    expect(isRootRoute(ROUTES.profile)).toBe(true);
    expect(isRootRoute(ROUTES.events)).toBe(false);
    expect(isRootRoute(requestRoute('r1'))).toBe(false);
  });

  it('returns a card to its list and a directory screen to Services', () => {
    expect(parentRoute(requestRoute('r1'))).toBe(ROUTES.requests);
    expect(parentRoute(eventRoute('e1'))).toBe(ROUTES.events);
    expect(parentRoute(ROUTES.contacts)).toBe(ROUTES.services);
    expect(parentRoute(ROUTES.newRequest)).toBe(ROUTES.requests);
    expect(parentRoute(ROUTES.house)).toBe(ROUTES.home);
  });
});

describe('startRoute', () => {
  it('starts with the welcome screen on first launch', () => {
    expect(startRoute('', false)).toBe(ROUTES.welcome);
  });

  it('starts with the welcome screen when MAX passes launch data in the hash', () => {
    expect(startRoute('#WebAppData=user%3D%7B%7D&WebAppPlatform=web', false)).toBe(ROUTES.welcome);
  });

  it('opens home once the welcome screen was seen', () => {
    expect(startRoute('', true)).toBe(ROUTES.home);
    expect(startRoute('#WebAppData=x', true)).toBe(ROUTES.home);
  });

  it('respects an explicit screen in the hash', () => {
    expect(startRoute('#/requests', false)).toBe(ROUTES.requests);
    expect(startRoute('#/', false)).toBe(ROUTES.home);
  });
});
