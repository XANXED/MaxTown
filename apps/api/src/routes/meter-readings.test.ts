import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Meter, ReadingsWindow } from '@maxtown/shared';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { houseDate, monthStart } from '../utility-payments/model.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('Показания Квартиры', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let apartmentId: string;
  const tokens: Record<string, string> = {};

  async function person(key: string, role: 'resident' | 'admin' | 'management-company', apartment: string | null): Promise<void> {
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [String(90_000 + Object.keys(tokens).length), `Имя ${key}`],
    );
    await pool.query(
      'INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)',
      [houseId, apartment, resident.rows[0]!.id, role],
    );
    tokens[key] = (await createSession(pool, resident.rows[0]!.id)).token;
  }

  const auth = (key: string) => ({ authorization: `Bearer ${tokens[key]}` });
  const readingsUrl = () => `/api/houses/${houseId}/readings`;
  const metersUrl = () => `/api/houses/${houseId}/meters`;

  beforeEach(async () => {
    for (const key of Object.keys(tokens)) delete tokens[key];
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Учётная, 1', 'Казань') RETURNING id")).rows[0]!.id;
    apartmentId = (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, '42'])).rows[0]!.id;
    const otherApartment = (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, '43'])).rows[0]!.id;
    await person('resident', 'resident', apartmentId);
    await person('same', 'resident', apartmentId);
    await person('admin', 'admin', apartmentId);
    await person('other', 'resident', otherApartment);
    await person('uk', 'management-company', null);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  async function createColdMeter(): Promise<Meter> {
    const response = await app.inject({
      method: 'POST', url: metersUrl(), headers: auth('resident'),
      payload: { kind: 'cold-water', title: 'Холодная вода, кухня', serial: '04521873', decimals: 3 },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ meter: Meter }>().meter;
  }

  it('keeps meters and readings private to active members of one Apartment', async () => {
    await createColdMeter();
    for (const key of ['resident', 'same', 'admin']) {
      const response = await app.inject({ method: 'GET', url: readingsUrl(), headers: auth(key) });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<ReadingsWindow>().meters).toHaveLength(1);
    }
    expect((await app.inject({ method: 'GET', url: readingsUrl(), headers: auth('other') })).json<ReadingsWindow>().meters).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: readingsUrl(), headers: auth('uk') })).statusCode).toBe(403);
  });

  it('shares the current value, permits correction, and rejects a value below the previous month', async () => {
    const meter = await createColdMeter();
    const first = await app.inject({
      method: 'POST', url: readingsUrl(), headers: auth('resident'),
      payload: { readings: [{ meterId: meter.id, value: 123.456 }] },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<ReadingsWindow>().meters[0]?.current?.value).toBe(123.456);

    const corrected = await app.inject({
      method: 'POST', url: readingsUrl(), headers: auth('same'),
      payload: { readings: [{ meterId: meter.id, value: 124.001 }] },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json<ReadingsWindow>().meters[0]?.current?.value).toBe(124.001);

    const currentMonth = monthStart(houseDate(new Date()));
    await pool.query('DELETE FROM utility_meter_readings WHERE meter_id = $1', [meter.id]);
    await pool.query(
      `INSERT INTO utility_meter_readings
         (meter_id, house_id, apartment_id, reading_month, value, submitted_by_membership_id)
       SELECT $1, $2, $3, ($4::date - interval '1 month')::date, 130, id
         FROM memberships WHERE house_id = $2 AND apartment_id = $3 LIMIT 1`,
      [meter.id, houseId, apartmentId, currentMonth],
    );
    const tooSmall = await app.inject({
      method: 'POST', url: readingsUrl(), headers: auth('resident'),
      payload: { readings: [{ meterId: meter.id, value: 129.999 }] },
    });
    expect(tooSmall.statusCode, tooSmall.body).toBe(409);
    expect(tooSmall.json()).toEqual({ error: 'reading_less_than_previous' });
  });

  it('updates and archives a meter with optimistic version checks', async () => {
    const meter = await createColdMeter();
    const updated = await app.inject({
      method: 'PUT', url: `${metersUrl()}/${meter.id}`, headers: auth('same'),
      payload: { kind: meter.kind, title: 'Холодная вода, ванная', serial: meter.serial, decimals: meter.decimals, version: meter.version },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const changed = updated.json<{ meter: Meter }>().meter;
    expect(changed).toMatchObject({ title: 'Холодная вода, ванная', version: meter.version + 1 });

    const stale = await app.inject({
      method: 'PUT', url: `${metersUrl()}/${meter.id}`, headers: auth('resident'),
      payload: { kind: meter.kind, title: 'Старое название', decimals: meter.decimals, version: meter.version },
    });
    expect(stale.statusCode, stale.body).toBe(409);

    const archived = await app.inject({
      method: 'POST', url: `${metersUrl()}/${meter.id}/archive`, headers: auth('admin'), payload: { version: changed.version },
    });
    expect(archived.statusCode, archived.body).toBe(204);
    expect((await app.inject({ method: 'GET', url: readingsUrl(), headers: auth('resident') })).json<ReadingsWindow>().meters).toHaveLength(0);
  });
});
