import { describe, expect, it, vi } from 'vitest';
import { addressLink, createPlacesClient, nearestGroups, NearestPlacesError } from './places.ts';
import { NEAREST_PLACE_KINDS } from '@maxtown/shared';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('places client', () => {
  it('asks the API for Nearest places of one kind', async () => {
    const fetcher = vi.fn(async () => response(200, { kind: 'trauma', places: [] }));
    await expect(createPlacesClient(fetcher).nearest('h 1', 'trauma')).resolves.toEqual({ kind: 'trauma', places: [] });
    expect(fetcher).toHaveBeenCalledWith('/api/houses/h%201/places/nearest/trauma');
  });

  it('tells apart a missing 2GIS key, 2GIS being down and a house not on the map', async () => {
    const problem = async (body: unknown, status: number) => {
      const error = await createPlacesClient(async () => response(status, body)).nearest('h1', 'mfc').catch((caught: unknown) => caught);
      return error instanceof NearestPlacesError ? error.problem : error;
    };
    expect(await problem({ error: 'nearest_places_not_configured' }, 503)).toBe('not-configured');
    expect(await problem({ error: 'nearest_places_unavailable' }, 502)).toBe('unavailable');
    expect(await problem({ error: 'house_location_unknown' }, 404)).toBe('location-unknown');
    expect(await problem({ error: 'forbidden' }, 403)).toBe('unavailable');
  });

  it('reads the house point for the map and reports why it is missing', async () => {
    await expect(createPlacesClient(async () => response(200, { house: { lat: 60.01, lon: 30.25 } })).location('h1')).resolves.toEqual({ lat: 60.01, lon: 30.25 });
    const error = await createPlacesClient(async () => response(404, { error: 'house_location_unknown' })).location('h1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NearestPlacesError);
    expect((error as NearestPlacesError).problem).toBe('location-unknown');
  });

  it('sends an Assigned place as JSON and uses PUT for an existing one', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response(200, { place: { id: 'p1' } }));
    const input = { kind: 'school' as const, title: 'Гимназия № 21', address: 'ул. Зорге, 71', hours: null, phone: null, note: null, point: { lat: 55.75, lon: 49.21 } };
    await createPlacesClient(fetcher).save('h1', input, 'p1');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/houses/h1/places/assigned/p1');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'PUT', body: JSON.stringify(input) });
  });
});

describe('Nearest place groups', () => {
  it('show every kind exactly once', () => {
    expect(nearestGroups.flatMap(({ kinds }) => kinds).sort()).toEqual([...NEAREST_PLACE_KINDS].sort());
  });
});

describe('addressLink', () => {
  it('searches the city and address in 2GIS', () => {
    expect(addressLink('Казань', 'ул. Лесная, 31')).toBe('https://2gis.ru/search/%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C%2C%20%D1%83%D0%BB.%20%D0%9B%D0%B5%D1%81%D0%BD%D0%B0%D1%8F%2C%2031');
  });
});
