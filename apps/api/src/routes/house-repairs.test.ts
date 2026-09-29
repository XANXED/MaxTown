import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('house repairs', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let managerToken: string;
  let residentToken: string;
  let foreignToken: string;

  async function createPerson(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>('INSERT INTO residents (max_user_id, display_name) VALUES ($1, $1) RETURNING id', [key]);
    const session = await createSession(pool, result.rows[0]!.id);
    return { id: result.rows[0]!.id, token: session.token };
  }

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Ремонта, 1', 'Казань') RETURNING id");
    houseId = house.rows[0]!.id;
    const apartment = await pool.query<{ id: string }>("INSERT INTO apartments (house_id, number) VALUES ($1, '1') RETURNING id", [houseId]);
    const resident = await createPerson('repairs-resident');
    residentToken = resident.token;
    const manager = await createPerson('repairs-headman');
    managerToken = manager.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident'), ($1, $2, $4, 'headman')", [houseId, apartment.rows[0]!.id, resident.id, manager.id]);
    const foreignHouse = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Чужая, 1', 'Казань') RETURNING id");
    const foreignApartment = await pool.query<{ id: string }>("INSERT INTO apartments (house_id, number) VALUES ($1, '1') RETURNING id", [foreignHouse.rows[0]!.id]);
    const foreign = await createPerson('repairs-foreign');
    foreignToken = foreign.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [foreignHouse.rows[0]!.id, foreignApartment.rows[0]!.id, foreign.id]);
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('creates multiple repairs, exposes their details to house members, and denies other houses', async () => {
    const headers = { authorization: `Bearer ${managerToken}` };
    const fields = {
      title: 'Замена стояка', description: 'Меняют трубы в подъезде.', location: 'Подъезд 2',
      startsAt: '2026-10-01T08:00:00.000Z', expectedCompletionAt: '2026-10-02T18:00:00.000Z',
      contractorName: 'ДомСервис', contractorContact: '+7 900 000-00-00',
      residentImpact: 'Будет шумно, перекроют доступ к кладовой.', instructions: 'Освободите проход.', status: 'planned',
    };
    const first = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/repairs`, headers, payload: fields });
    const second = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/repairs`, headers, payload: { ...fields, title: 'Ремонт лифта' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const residentList = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/repairs`, headers: { authorization: `Bearer ${residentToken}` } });
    expect(residentList.json<{ repairs: Array<Record<string, unknown>> }>().repairs).toHaveLength(2);
    const returnedRepairs = residentList.json<{ repairs: Array<Record<string, unknown>> }>().repairs;
    expect(returnedRepairs.map((repair) => repair.title).sort()).toEqual(['Замена стояка', 'Ремонт лифта']);
    expect(returnedRepairs.find((repair) => repair.title === 'Замена стояка')).toMatchObject({ status: 'planned', location: 'Подъезд 2', contractorName: 'ДомСервис' });
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/repairs`, headers: { authorization: `Bearer ${foreignToken}` } })).statusCode).toBe(403);
  });

  it('restricts edits and enforces valid status changes with an attributable history', async () => {
    const managerHeaders = { authorization: `Bearer ${managerToken}` };
    const residentHeaders = { authorization: `Bearer ${residentToken}` };
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/repairs`, headers: managerHeaders, payload: { title: 'Ремонт крыши', description: 'Работы на кровле', status: 'in_progress' } });
    const repairId = created.json<{ repair: { id: string } }>().repair.id;
    expect((await app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers: residentHeaders, payload: { status: 'completed' } })).statusCode).toBe(403);
    const completed = await app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers: managerHeaders, payload: { status: 'completed', note: 'Работы приняты' } });
    expect(completed.statusCode).toBe(200);
    const reopenWithoutNote = await app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers: managerHeaders, payload: { status: 'in_progress' } });
    expect(reopenWithoutNote.statusCode).toBe(400);
    const reopened = await app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers: managerHeaders, payload: { status: 'in_progress', note: 'Подрядчик устраняет замечания' } });
    expect(reopened.statusCode).toBe(200);
    const history = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/repairs/${repairId}/history`, headers: residentHeaders });
    expect(history.json<{ history: Array<{ eventType: string; actor: { role: string } }> }>().history.map((entry) => entry.eventType)).toEqual(['house_repair.created', 'house_repair.status_changed', 'house_repair.status_changed']);
    expect(history.json<{ history: Array<{ eventType: string; actor: { role: string } }> }>().history[0]?.actor.role).toBe('headman');
  });

  it('rejects invalid content and schedule without writing an event', async () => {
    const headers = { authorization: `Bearer ${managerToken}` };
    const invalid = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/repairs`, headers, payload: { title: '  ', description: 'x', status: 'planned', startsAt: '2026-10-02T08:00:00.000Z', expectedCompletionAt: '2026-10-01T08:00:00.000Z' } });
    expect(invalid.statusCode).toBe(400);
    expect(await pool.query("SELECT id FROM audit_events WHERE event_type LIKE 'house_repair.%'").then((result) => result.rowCount)).toBe(0);
  });

  it('serializes concurrent terminal transitions so cancellation and completion cannot both win', async () => {
    const headers = { authorization: `Bearer ${managerToken}` };
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/repairs`, headers, payload: { title: 'Ремонт ворот', description: 'Работы во дворе', status: 'in_progress' } });
    const repairId = created.json<{ repair: { id: string } }>().repair.id;
    await app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers, payload: { status: 'paused' } });
    const results = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers, payload: { status: 'completed' } }),
      app.inject({ method: 'PATCH', url: `/api/houses/${houseId}/repairs/${repairId}`, headers, payload: { status: 'cancelled' } }),
    ]);
    expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 400]);
    const final = await pool.query<{ status: string }>('SELECT status FROM house_repairs WHERE id = $1', [repairId]);
    expect(['completed', 'cancelled']).toContain(final.rows[0]?.status);
  });
});
