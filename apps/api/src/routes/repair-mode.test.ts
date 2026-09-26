import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('house repair mode', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let residentToken: string;
  let foreignToken: string;
  let responsibleToken: string;
  let responsibleMembershipId: string;
  let headmanToken: string;

  async function createPerson(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, display_name) VALUES ($1, $1) RETURNING id", [key]);
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
    const resident = await createPerson('repair-resident');
    residentToken = resident.token;
    const responsible = await createPerson('repair-responsible');
    responsibleToken = responsible.token;
    const responsibleMembership = await pool.query<{ id: string }>("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'responsible') RETURNING id", [houseId, apartment.rows[0]!.id, responsible.id]);
    responsibleMembershipId = responsibleMembership.rows[0]!.id;
    const headman = await createPerson('repair-headman');
    headmanToken = headman.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'headman')", [houseId, apartment.rows[0]!.id, headman.id]);
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [houseId, apartment.rows[0]!.id, resident.id]);
    const foreignHouse = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Чужая, 1', 'Казань') RETURNING id");
    const foreignHouseId = foreignHouse.rows[0]!.id;
    const foreignApartment = await pool.query<{ id: string }>("INSERT INTO apartments (house_id, number) VALUES ($1, '1') RETURNING id", [foreignHouseId]);
    const foreign = await createPerson('repair-foreign');
    foreignToken = foreign.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [foreignHouseId, foreignApartment.rows[0]!.id, foreign.id]);
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('returns inactive by default to members and denies membership from another house', async () => {
    const member = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/repair-mode`, headers: { authorization: `Bearer ${residentToken}` } });
    expect(member.statusCode).toBe(200);
    expect(member.json<{ repairMode: { isActive: boolean; title: string | null; updatedAt: string | null } }>().repairMode).toMatchObject({ isActive: false, title: null, updatedAt: null });
    const foreign = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/repair-mode`, headers: { authorization: `Bearer ${foreignToken}` } });
    expect(foreign.statusCode).toBe(403);
  });

  it('allows headman and responsible to activate, edit, and complete with immutable actor/time audit events', async () => {
    const headers = { authorization: `Bearer ${responsibleToken}` };
    const activePayload = {
      isActive: true,
      title: 'Замена стояка холодной воды',
      description: 'Работы в подъезде и квартирах по стояку.',
      startsAt: '2026-09-26T08:00:00.000Z',
      expectedCompletionAt: '2026-09-27T18:00:00.000Z',
      instructions: 'Освободите доступ к трубам.',
    };
    const active = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers, payload: activePayload });
    expect(active.statusCode).toBe(200);
    expect(active.json<{ repairMode: Record<string, unknown> }>().repairMode).toMatchObject({ ...activePayload, updatedBy: { role: 'responsible' } });
    const edited = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers, payload: { ...activePayload, expectedCompletionAt: '2026-09-28T18:00:00.000Z' } });
    expect(edited.statusCode).toBe(200);
    const completed = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers, payload: { isActive: false } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<{ repairMode: Record<string, unknown> }>().repairMode).toMatchObject({ isActive: false, title: null, expectedCompletionAt: null });
    const audit = await pool.query<{ actor_membership_id: string; event_type: string; occurred_at: Date; details: { before: { isActive: boolean }; after: { isActive: boolean } } }>(
      'SELECT actor_membership_id, event_type, occurred_at, details FROM audit_events WHERE house_id = $1 ORDER BY occurred_at, id', [houseId],
    );
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.map((row) => row.event_type)).toEqual(['repair_mode.activated', 'repair_mode.updated', 'repair_mode.completed']);
    expect(audit.rows.every((row) => row.actor_membership_id === responsibleMembershipId && row.occurred_at instanceof Date)).toBe(true);
    expect(audit.rows[0]?.details).toMatchObject({ before: { isActive: false }, after: { isActive: true } });
    expect(audit.rows[2]?.details).toMatchObject({ before: { isActive: true }, after: { isActive: false } });
    await expect(pool.query('UPDATE audit_events SET event_type = $1 WHERE house_id = $2', ['rewritten', houseId])).rejects.toThrow('audit_events are append-only');
    await expect(pool.query('DELETE FROM audit_events WHERE house_id = $1', [houseId])).rejects.toThrow('audit_events are append-only');
  });

  it('rejects resident edits, foreign-house IDs, and invalid schedules without audit writes', async () => {
    const resident = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers: { authorization: `Bearer ${residentToken}` }, payload: { isActive: false } });
    expect(resident.statusCode).toBe(403);
    const foreign = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers: { authorization: `Bearer ${foreignToken}` }, payload: { isActive: false } });
    expect(foreign.statusCode).toBe(403);
    const headers = { authorization: `Bearer ${responsibleToken}` };
    const missingDescription = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers, payload: { isActive: true, title: 'Работы' } });
    expect(missingDescription.statusCode).toBe(400);
    const invertedSchedule = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/repair-mode`, headers, payload: { isActive: true, title: 'Работы', description: 'Описание', startsAt: '2026-09-28T18:00:00.000Z', expectedCompletionAt: '2026-09-27T08:00:00.000Z' } });
    expect(invertedSchedule.statusCode).toBe(400);
    expect(await pool.query('SELECT id FROM audit_events WHERE house_id = $1', [houseId]).then(({ rowCount }) => rowCount)).toBe(0);
  });

  it('allows the Headman to publish repair information', async () => {
    const response = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/repair-mode`,
      headers: { authorization: `Bearer ${headmanToken}` },
      payload: { isActive: true, title: 'Покраска подъезда', description: 'Работы на первом этаже.', startsAt: '2026-09-27T08:00:00.000Z' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ repairMode: { updatedBy: { role: string } } }>().repairMode.updatedBy.role).toBe('headman');
  });
});
