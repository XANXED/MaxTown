import { describe, expect, it } from 'vitest';
import { hashForRoute, routeFromHash, ROUTES, startRoute } from './routes.ts';

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

  it('falls back to home for removed demo screens', () => {
    expect(routeFromHash('#/requests/2458')).toBe(ROUTES.home);
    expect(routeFromHash('#/events/hot-water')).toBe(ROUTES.home);
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
