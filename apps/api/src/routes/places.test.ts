import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignedPlaceInput } from '@maxtown/shared';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import type { DgisClient } from '../places/dgis.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

const clinic: AssignedPlaceInput = {
  kind: 'adult-clinic',
  title: 'Поликлиника № 114',
  address: 'Камышовая улица, 38',
  hours: 'Пн–пт 8:00–20:00',
  phone: '+7 812 246-38-00',
  note: null,
  point: { lat: 60.0081, lon: 30.2459 },
};

describe.skipIf(!databaseUrl)('Places API', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let residentToken: string;
  let headmanToken: string;
  let foreignToken: string;
  let apartmentNumber = 0;

  async function addMember(targetHouseId: string, key: string, role: 'resident' | 'admin'): Promise<string> {
    const person = await pool.query<{ id: string }>('INSERT INTO residents (max_user_id, display_name) VALUES ($1, $1) RETURNING id', [key]);
    apartmentNumber += 1;
    const apartment = await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [targetHouseId, String(apartmentNumber)]);
    await pool.query('INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)', [targetHouseId, apartment.rows[0]!.id, person.rows[0]!.id, role]);
    return (await createSession(pool, person.rows[0]!.id)).token;
  }

  async function start(dgis: DgisClient | null): Promise<void> {
    app = await buildApp({ pool, env: { NODE_ENV: 'test' }, dgis });
  }

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeEach(async () => {
    apartmentNumber = 0;
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const houses = await pool.query<{ id: string }>(
      "INSERT INTO houses (address, locality) VALUES ('Комендантский проспект, 19 к3', 'Санкт-Петербург'), ('ул. Другая, 2', 'Казань') RETURNING id",
    );
    houseId = houses.rows[0]!.id;
    residentToken = await addMember(houseId, 'places-resident', 'resident');
    headmanToken = await addMember(houseId, 'places-headman', 'admin');
    foreignToken = await addMember(houses.rows[1]!.id, 'places-foreign', 'resident');
  });

  afterEach(async () => {
    await app?.close();
    if (!app) await pool?.end();
  });

  it('lets members read Assigned places and lets only the Староста change them', async () => {
    await start(null);
    const url = `/api/houses/${houseId}/places/assigned`;

    expect((await app.inject({ method: 'POST', url, headers: as(residentToken), payload: clinic })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url, headers: as(headmanToken), payload: clinic });
    expect(created.statusCode).toBe(201);
    const { place } = created.json<{ place: { id: string } }>();

    const read = await app.inject({ method: 'GET', url, headers: as(residentToken) });
    expect(read.json()).toEqual({
      places: [expect.objectContaining({ id: place.id, kind: 'adult-clinic', title: 'Поликлиника № 114', point: { lat: 60.0081, lon: 30.2459 } })],
    });
    expect((await app.inject({ method: 'GET', url, headers: as(foreignToken) })).statusCode).toBe(403);

    const updated = await app.inject({ method: 'PUT', url: `${url}/${place.id}`, headers: as(headmanToken), payload: { ...clinic, note: 'Кабинет 12', point: null } });
    expect(updated.json()).toEqual({ place: expect.objectContaining({ note: 'Кабинет 12' }) });
    expect(updated.json<{ place: { point?: unknown } }>().place.point).toBeUndefined();
    const partial = await app.inject({ method: 'PUT', url: `${url}/${place.id}`, headers: as(headmanToken), payload: { ...clinic, point: { lat: 60 } } });
    expect(partial.statusCode).toBe(400);

    expect((await app.inject({ method: 'DELETE', url: `${url}/${place.id}`, headers: as(residentToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `${url}/${place.id}`, headers: as(headmanToken) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url, headers: as(residentToken) })).json()).toEqual({ places: [] });

    const audit = await pool.query<{ event_type: string }>('SELECT event_type FROM audit_events WHERE house_id = $1 ORDER BY occurred_at', [houseId]);
    expect(audit.rows.map(({ event_type }) => event_type)).toEqual([
      'house_assigned_place.created', 'house_assigned_place.updated', 'house_assigned_place.deleted',
    ]);
  });

  it('looks up Nearest places around the geocoded house without storing them', async () => {
    const dgis: DgisClient = {
      geocode: vi.fn(async () => ({ lat: 60.013259, lon: 30.257439 })),
      nearest: vi.fn(async () => [
        { id: '1', title: 'Травматологическое отделение', point: { lat: 60.02, lon: 30.3 }, distance: 2789, open24x7: true, hoursToday: 'Круглосуточно', url: 'https://2gis.ru/firm/1' },
      ]),
    };
    await start(dgis);
    const url = `/api/houses/${houseId}/places/nearest/trauma`;

    const first = await app.inject({ method: 'GET', url, headers: as(residentToken) });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toEqual({
      kind: 'trauma',
      house: { lat: 60.013259, lon: 30.257439 },
      places: [expect.objectContaining({ title: 'Травматологическое отделение', point: { lat: 60.02, lon: 30.3 } })],
    });
    await app.inject({ method: 'GET', url, headers: as(residentToken) });

    const location = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/places/location`, headers: as(residentToken) });
    expect(location.json()).toEqual({ house: { lat: 60.013259, lon: 30.257439 } });
    expect(location.headers['cache-control']).toBe('no-store');

    expect(dgis.geocode).toHaveBeenCalledTimes(1);
    expect(dgis.geocode).toHaveBeenCalledWith('Комендантский проспект, 19 к3', 'Санкт-Петербург');
    expect(dgis.nearest).toHaveBeenCalledTimes(2);
    expect((await app.inject({ method: 'GET', url, headers: as(foreignToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/places/nearest/grocery`, headers: as(residentToken) })).statusCode).toBe(400);
  });

  it('looks the house up again after its address changes instead of reusing the old answer', async () => {
    const geocode = vi.fn(async (address: string) => (address.startsWith('Комендантский') ? { lat: 60.0081, lon: 30.2583 } : undefined));
    await start({ geocode, nearest: async () => [] });
    const url = `/api/houses/${houseId}/places/location`;

    await pool.query("UPDATE houses SET address = 'Лол', locality = 'Лол' WHERE id = $1", [houseId]);
    expect((await app.inject({ method: 'GET', url, headers: as(residentToken) })).json()).toEqual({ error: 'house_location_unknown' });

    await pool.query("UPDATE houses SET address = 'Комендантский проспект, 14 к1', locality = 'Санкт-Петербург' WHERE id = $1", [houseId]);
    expect((await app.inject({ method: 'GET', url, headers: as(residentToken) })).json()).toEqual({ house: { lat: 60.0081, lon: 30.2583 } });
    expect(geocode).toHaveBeenLastCalledWith('Комендантский проспект, 14 к1', 'Санкт-Петербург');
  });

  const mfcUrl = () => `/api/houses/${houseId}/places/nearest/mfc`;

  it('says Nearest places are off without a 2GIS key', async () => {
    await start(null);
    expect((await app.inject({ method: 'GET', url: mfcUrl(), headers: as(residentToken) })).json()).toEqual({ error: 'nearest_places_not_configured' });
  });

  it('reports 2GIS being unreachable instead of an empty list', async () => {
    await start({ geocode: async () => { throw new Error('down'); }, nearest: async () => [] });
    const response = await app.inject({ method: 'GET', url: mfcUrl(), headers: as(residentToken) });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'nearest_places_unavailable' });
  });

  it('reports a house 2GIS cannot find on the map', async () => {
    await start({ geocode: async () => undefined, nearest: async () => [] });
    expect((await app.inject({ method: 'GET', url: mfcUrl(), headers: as(residentToken) })).json()).toEqual({ error: 'house_location_unknown' });
  });
});
