import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

type Person = { residentId: string; membershipId: string; token: string; apartmentId: string | null };

describe.skipIf(!databaseUrl)('apartment repairs', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let target: Person;
  let sameApartment: Person;
  let admin: Person;
  let management: Person;
  const neighbors: Person[] = [];
  let diagonal: Person;
  let foreignEntrance: Person;
  let personIndex = 0;

  async function addApartment(number: string, entrance: number, floor: number, column: number): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO apartments (house_id, number, entrance, floor, layout_column) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [houseId, number, entrance, floor, column],
    );
    return result.rows[0]!.id;
  }

  async function addPerson(key: string, role: 'resident' | 'admin' | 'management-company', apartmentId: string | null): Promise<Person> {
    personIndex += 1;
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [String(10_000 + personIndex), `Секретное имя ${key}`],
    );
    const membership = await pool.query<{ id: string }>(
      'INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [houseId, apartmentId, resident.rows[0]!.id, role],
    );
    const session = await createSession(pool, resident.rows[0]!.id);
    return { residentId: resident.rows[0]!.id, membershipId: membership.rows[0]!.id, token: session.token, apartmentId };
  }

  beforeEach(async () => {
    neighbors.length = 0;
    personIndex = 0;
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Соседская, 1', 'Казань') RETURNING id");
    houseId = house.rows[0]!.id;
    const targetApartment = await addApartment('20', 1, 2, 0);
    const left = await addApartment('19', 1, 2, -1);
    const right = await addApartment('21', 1, 2, 1);
    const above = await addApartment('30', 1, 3, 0);
    const below = await addApartment('10', 1, 1, 0);
    const diagonalApartment = await addApartment('31', 1, 3, 1);
    const foreignApartment = await addApartment('120', 2, 2, 0);
    target = await addPerson('author', 'resident', targetApartment);
    sameApartment = await addPerson('same', 'resident', targetApartment);
    neighbors.push(
      await addPerson('left-a', 'resident', left),
      await addPerson('left-b', 'resident', left),
      await addPerson('right', 'resident', right),
      await addPerson('above', 'resident', above),
      await addPerson('below', 'resident', below),
    );
    diagonal = await addPerson('diagonal', 'resident', diagonalApartment);
    foreignEntrance = await addPerson('other-entrance', 'resident', foreignApartment);
    admin = await addPerson('admin', 'admin', null);
    management = await addPerson('management', 'management-company', null);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  function headers(person: Person): { authorization: string } {
    return { authorization: `Bearer ${person.token}` };
  }

  it('пишет период в уведомлении по времени Дома и даёт Администратору объявить ремонт своей Квартиры', async () => {
    // 10:00–12:00 по Москве через неделю: сервер в UTC не должен сдвигать часы.
    const start = new Date(Date.now() + 7 * 24 * 3_600_000);
    start.setUTCHours(7, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const adminHome = await addPerson('admin-home', 'admin', neighbors[4]!.apartmentId);
    const created = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(adminHome),
      payload: { workTypes: ['drilling'], startsAt: start.toISOString(), endsAt: end.toISOString() },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = await pool.query<{ body: string }>("SELECT body FROM in_app_notifications WHERE kind = 'apartment-repair' LIMIT 1");
    expect(body.rows[0]?.body).toMatch(/, 10:00 — \d+ \S+, 12:00\./);

    const forManagement = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(management),
      payload: { workTypes: ['drilling'], startsAt: start.toISOString(), endsAt: end.toISOString() },
    });
    expect(forManagement.json()).toEqual({ error: 'apartment_required' });
  });

  it('notifies only active residents in the four orthogonal apartments and never exposes the author name', async () => {
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const created = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(target),
      payload: { workTypes: ['drilling', 'flooring'], details: 'Будет шумно', startsAt, endsAt },
    });
    expect(created.statusCode).toBe(201);
    const repair = created.json<{ repair: { id: string; apartmentNumber: string; state: string } }>().repair;
    expect(repair).toMatchObject({ apartmentNumber: '20', state: 'scheduled' });

    const notified = await pool.query<{ resident_id: string; title: string; body: string }>(
      "SELECT resident_id, title, body FROM in_app_notifications WHERE kind = 'apartment-repair' ORDER BY resident_id",
    );
    expect(new Set(notified.rows.map((row) => row.resident_id))).toEqual(new Set(neighbors.map((person) => person.residentId)));
    expect(notified.rows.every((row) => row.title.includes('Квартира №20') && row.body.includes('Будет шумно'))).toBe(true);
    expect(JSON.stringify(notified.rows)).not.toContain('Секретное имя');

    const outbox = await pool.query<{ resident_id: string }>('SELECT resident_id FROM max_direct_message_outbox ORDER BY resident_id');
    expect(new Set(outbox.rows.map((row) => row.resident_id))).toEqual(new Set(neighbors.map((person) => person.residentId)));

    for (const hidden of [diagonal, foreignEntrance]) {
      const list = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(hidden) });
      expect(list.json<{ repairs: unknown[] }>().repairs).toHaveLength(0);
    }
    const sameHome = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(sameApartment) });
    expect(sameHome.json<{ repairs: Array<{ id: string; canEdit: boolean }> }>().repairs).toEqual([expect.objectContaining({ id: repair.id, canEdit: false })]);
    const adjacent = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(neighbors[0]!) });
    expect(adjacent.json<{ repairs: Array<{ id: string }> }>().repairs.map((item) => item.id)).toContain(repair.id);
    const notifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: headers(neighbors[0]!) });
    expect(notifications.json<{ notifications: Array<{ kind: string; repairId: string }> }>().notifications)
      .toContainEqual(expect.objectContaining({ kind: 'apartment-repair', repairId: repair.id }));
    const manager = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(management) });
    expect(manager.json<{ repairs: Array<{ id: string }> }>().repairs.map((item) => item.id)).toContain(repair.id);

    const duplicate = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(target),
      payload: { workTypes: ['other'], startsAt, endsAt },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: 'apartment_repair_exists' });
  });

  it('lets a resident move only their apartment, an admin move any apartment, and UK only read the layout', async () => {
    const residentForbidden = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${neighbors[0]!.apartmentId}/layout`, headers: headers(target),
      payload: { entrance: 1, floor: 4, column: 0 },
    });
    expect(residentForbidden.statusCode).toBe(403);

    const ukForbidden = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${target.apartmentId}/layout`, headers: headers(management),
      payload: { entrance: 1, floor: 4, column: 0 },
    });
    expect(ukForbidden.statusCode).toBe(403);

    const occupied = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${target.apartmentId}/layout`, headers: headers(admin),
      payload: { entrance: 1, floor: 2, column: 1 },
    });
    expect(occupied.statusCode).toBe(409);

    const moved = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${target.apartmentId}/layout`, headers: headers(admin),
      payload: { entrance: 1, floor: 4, column: 0 },
    });
    expect(moved.statusCode).toBe(200);
  });

  it('enforces lifecycle permissions, automatic completion, and locks the affected layout while repair is open', async () => {
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const created = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(target),
      payload: { workTypes: ['demolition'], startsAt, endsAt },
    });
    const repairId = created.json<{ repair: { id: string } }>().repair.id;

    const ukEdit = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartment-repairs/${repairId}`, headers: headers(management),
      payload: { workTypes: ['finishing'], startsAt, endsAt },
    });
    expect(ukEdit.statusCode).toBe(403);

    const adminEdit = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartment-repairs/${repairId}`, headers: headers(admin),
      payload: { workTypes: ['demolition', 'electrical'], details: 'Изменённый план', startsAt, endsAt },
    });
    expect(adminEdit.statusCode).toBe(200);
    expect(adminEdit.json<{ repair: { version: number; canEdit: boolean } }>().repair).toMatchObject({ version: 2, canEdit: true });
    const repeated = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartment-repairs/${repairId}`, headers: headers(admin),
      payload: { workTypes: ['electrical', 'demolition'], details: 'Изменённый план', startsAt, endsAt },
    });
    expect(repeated.json<{ repair: { version: number } }>().repair.version).toBe(2);

    const moveTarget = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${target.apartmentId}/layout`, headers: headers(admin),
      payload: { entrance: 1, floor: 4, column: 0 },
    });
    expect(moveTarget.statusCode).toBe(409);
    expect(moveTarget.json()).toEqual({ error: 'layout_locked_by_repair' });

    const moveNeighbor = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/apartments/${neighbors[0]!.apartmentId}/layout`, headers: headers(admin),
      payload: { entrance: 1, floor: 4, column: 0 },
    });
    expect(moveNeighbor.statusCode).toBe(409);

    const cancelled = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/apartment-repairs/${repairId}/cancel`, headers: headers(target) });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ repair: { state: string; version: number } }>().repair).toMatchObject({ state: 'cancelled', version: 3 });
    const notices = await pool.query<{ resident_id: string; versions: number[] }>(
      `SELECT resident_id, array_agg(apartment_repair_version ORDER BY apartment_repair_version) AS versions
         FROM in_app_notifications WHERE apartment_repair_id = $1 GROUP BY resident_id`, [repairId],
    );
    expect(notices.rows).toHaveLength(neighbors.length);
    expect(notices.rows.every((row) => row.versions.join(',') === '1,2,3')).toBe(true);

    const activeStart = new Date(Date.now() - 60_000).toISOString();
    const activeEnd = new Date(Date.now() + 3_600_000).toISOString();
    const active = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-repairs`, headers: headers(target),
      payload: { workTypes: ['drilling'], startsAt: activeStart, endsAt: activeEnd },
    });
    expect(active.json<{ repair: { state: string } }>().repair.state).toBe('active');
    const activeId = active.json<{ repair: { id: string } }>().repair.id;
    const completed = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/apartment-repairs/${activeId}/complete`, headers: headers(admin) });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<{ repair: { state: string } }>().repair.state).toBe('completed');

    const expired = await pool.query<{ id: string }>(
      `INSERT INTO apartment_repairs
        (house_id, apartment_id, created_by_membership_id, work_types, starts_at, ends_at)
       VALUES ($1, $2, $3, ARRAY['other'], now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
      [houseId, target.apartmentId, target.membershipId],
    );
    const expiredResponse = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/apartment-repairs/${expired.rows[0]!.id}`, headers: headers(target) });
    expect(expiredResponse.json<{ repair: { state: string } }>().repair.state).toBe('completed');
  });
});
