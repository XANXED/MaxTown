import { describe, expect, it } from 'vitest';
import {
  eventRoute,
  internetProviderEditRoute,
  contactEditRoute,
  hashForRoute,
  isRootRoute,
  matchCard,
  matchContactEditor,
  matchInternetProviderEditor,
  matchNearestPlaces,
  matchPlaceEditor,
  nearestPlacesRoute,
  placeEditRoute,
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

  it('opens contact create and edit screens', () => {
    expect(routeFromHash('#/contacts/new')).toBe(ROUTES.newContact);
    expect(routeFromHash('#/contacts/c-17/edit')).toBe('/contacts/c-17/edit');
    expect(matchContactEditor(contactEditRoute('c-17'))).toEqual({ id: 'c-17' });
    expect(matchContactEditor(ROUTES.newContact)).toBeNull();
  });

  it('opens the House internet catalog and returns it to Services', () => {
    expect(routeFromHash('#/internet')).toBe(ROUTES.internet);
    expect(parentRoute(ROUTES.internet)).toBe(ROUTES.services);
    expect(routeFromHash('#/internet/provider-7/edit')).toBe('/internet/provider-7/edit');
    expect(matchInternetProviderEditor(internetProviderEditRoute('provider-7'))).toEqual({ id: 'provider-7' });
    expect(parentRoute(internetProviderEditRoute('provider-7'))).toBe(ROUTES.internet);
  });

  it('opens Assigned place forms and Nearest places of a known kind only', () => {
    expect(routeFromHash('#/places/new')).toBe(ROUTES.newPlace);
    expect(matchPlaceEditor(routeFromHash('#/places/abc-1/edit'))).toEqual({ id: 'abc-1' });
    expect(matchNearestPlaces(routeFromHash('#/places/nearest/trauma'))).toEqual({ kind: 'trauma' });
    expect(routeFromHash('#/places/nearest/grocery')).toBe(ROUTES.home);
    expect(parentRoute(nearestPlacesRoute('pharmacy-24'))).toBe(ROUTES.places);
    expect(parentRoute(placeEditRoute('abc-1'))).toBe(ROUTES.places);
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
    expect(parentRoute(ROUTES.newContact)).toBe(ROUTES.contacts);
    expect(parentRoute(contactEditRoute('c-17'))).toBe(ROUTES.contacts);
    expect(parentRoute(ROUTES.newRequest)).toBe(ROUTES.requests);
    expect(parentRoute(ROUTES.house)).toBe(ROUTES.home);
  });
});

describe('startRoute', () => {
  it('starts with the welcome screen on first launch', () => {
    expect(startRoute('', false)).toBe(ROUTES.welcome);
  });

  it('opens home once the welcome screen was seen', () => {
    expect(startRoute('', true)).toBe(ROUTES.home);
  });

  it('respects an explicit screen in the hash', () => {
    expect(startRoute('#/requests', false)).toBe(ROUTES.requests);
    expect(startRoute('#/', false)).toBe(ROUTES.home);
  });
});
