import { describe, expect, it, vi } from 'vitest';
import { createDgisClient, firmUrl, hoursToday, nearestQueries } from './dgis.ts';

const HOUSE = { lat: 60.013259, lon: 30.257439 };
// Понедельник, 12:00 по Москве.
const MONDAY_NOON = new Date('2026-09-28T09:00:00Z');

function reply(body: unknown) {
  return { json: async () => body };
}

describe('2GIS helpers', () => {
  it('formats today’s hours in the house time zone and marks 24/7 and days off', () => {
    const schedule = { Mon: { working_hours: [{ from: '09:30', to: '14:00' }, { from: '15:00', to: '21:00' }] } };
    expect(hoursToday(schedule, MONDAY_NOON)).toBe('9:30–14:00, 15:00–21:00');
    expect(hoursToday({ ...schedule, is_24x7: true }, MONDAY_NOON)).toBe('Круглосуточно');
    expect(hoursToday({ Tue: { working_hours: [{ from: '10:00', to: '18:00' }] } }, MONDAY_NOON)).toBeNull();
    expect(hoursToday(undefined, MONDAY_NOON)).toBeUndefined();
  });

  it('links to the firm card without the branch hash', () => {
    expect(firmUrl('70000001054059924_abc123')).toBe('https://2gis.ru/firm/70000001054059924');
  });
});

describe('createDgisClient', () => {
  it('searches the kind’s rubric around the house, sorted by distance, and keeps only 24/7 where required', async () => {
    const fetcher = vi.fn(async (_url: URL) => reply({
      meta: { code: 200 },
      result: {
        items: [
          { id: '2', name: 'Дневная аптека', point: { lat: 60.0135, lon: 30.2575 }, schedule: { Mon: { working_hours: [{ from: '09:00', to: '21:00' }] } } },
          { id: '1', name: 'Круглосуточная', address_name: 'ул. Ильюшина, 14', point: { lat: 60.014, lon: 30.258 }, schedule: { is_24x7: true } },
        ],
      },
    }));
    const client = createDgisClient({ key: 'test', fetcher });

    const places = await client.nearest('pharmacy-24', HOUSE, MONDAY_NOON);

    const url = fetcher.mock.calls[0]![0];
    expect(url.pathname).toBe('/3.0/items');
    expect(url.searchParams.get('rubric_id')).toBe(nearestQueries['pharmacy-24'].rubricId);
    expect(url.searchParams.get('q')).toBe('круглосуточная аптека');
    expect(url.searchParams.get('point')).toBe('30.257439,60.013259');
    expect(url.searchParams.get('sort')).toBe('distance');
    expect(places).toEqual([
      expect.objectContaining({
        id: '1', title: 'Круглосуточная', address: 'ул. Ильюшина, 14', point: { lat: 60.014, lon: 30.258 },
        open24x7: true, hoursToday: 'Круглосуточно', url: 'https://2gis.ru/firm/1',
      }),
    ]);
    expect(places[0]!.distance).toBeGreaterThan(0);
  });

  it('treats «nothing found» as an empty list and retries a dropped connection once', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(reply({ meta: { code: 404 } }));
    const client = createDgisClient({ key: 'test', fetcher });

    await expect(client.nearest('trauma', HOUSE)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails on an API error instead of pretending nothing is nearby', async () => {
    const client = createDgisClient({ key: 'bad', fetcher: async () => reply({ meta: { code: 403, error: { message: 'Key is invalid' } } }) });
    await expect(client.nearest('mfc', HOUSE)).rejects.toThrow('2GIS 403');
  });

  it('geocodes the house by locality and address', async () => {
    const fetcher = vi.fn(async (_url: URL) => reply({ meta: { code: 200 }, result: { items: [{ id: 'b', point: HOUSE }] } }));
    const client = createDgisClient({ key: 'test', fetcher });

    await expect(client.geocode('Комендантский проспект, 19 к3', 'Санкт-Петербург')).resolves.toEqual(HOUSE);
    expect(fetcher.mock.calls[0]![0].searchParams.get('q')).toBe('Санкт-Петербург, Комендантский проспект, 19 к3');
  });
});
