import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('moderator registration routes', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let registrationId: string;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    await pool.query('TRUNCATE TABLE moderators CASCADE');
    const resident = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, display_name) VALUES ('moderator-test', 'Староста') RETURNING id");
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO house_registrations (submitted_by_resident_id, address, locality, apartment_number)
       VALUES ($1, 'ул. Модераторская, 2', 'Казань', '45') RETURNING id`, [resident.rows[0]!.id],
    );
    registrationId = registration.rows[0]!.id;
    await pool.query("INSERT INTO moderators (principal) VALUES ('moderator@example.org')");
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app.close(); });

  it('rejects missing, unknown, and disabled moderator principals', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations', headers: { 'x-maxtown-moderator': 'attacker' } })).statusCode).toBe(401);
    await pool.query("UPDATE moderators SET disabled_at = now() WHERE principal = 'moderator@example.org'");
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations', headers: { 'x-maxtown-moderator': 'moderator@example.org' } })).statusCode).toBe(401);
  });

  it('approves a registration, creates the House and headman membership, and records the proxy principal', async () => {
    const headers = { 'x-maxtown-moderator': 'moderator@example.org' };
    const list = await app.inject({ method: 'GET', url: '/api/moderator/registrations?status=pending', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ registrations: Array<{ id: string }> }>().registrations[0]?.id).toBe(registrationId);
    const decision = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'approve' } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(await pool.query("SELECT 1 FROM houses h JOIN house_registrations r ON r.house_id = h.id JOIN memberships m ON m.house_id = h.id WHERE r.id = $1 AND m.role = 'headman'", [registrationId]).then(({ rowCount }) => rowCount)).toBe(1);
    expect(await pool.query('SELECT decided_by_principal FROM house_registrations WHERE id = $1', [registrationId]).then(({ rows }) => rows[0]?.decided_by_principal)).toBe('moderator@example.org');

    const duplicatePerson = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, display_name) VALUES ('moderator-duplicate', 'Сосед') RETURNING id");
    const duplicate = await pool.query<{ id: string }>(
      `INSERT INTO house_registrations (submitted_by_resident_id, address, locality, apartment_number)
       VALUES ($1, 'ул. Модераторская, 2', 'Казань', '46') RETURNING id`, [duplicatePerson.rows[0]!.id],
    );
    const duplicateDecision = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${duplicate.rows[0]!.id}/decision`, headers, payload: { decision: 'approve' } });
    expect(duplicateDecision.statusCode).toBe(409);
  });

  it('requires a useful rejection reason and allows only one decision', async () => {
    const headers = { 'x-maxtown-moderator': 'moderator@example.org' };
    const invalid = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'reject', reason: 'нет' } });
    expect(invalid.statusCode).toBe(400);
    const rejected = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'reject', reason: 'Адрес не совпадает' } });
    const repeated = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'approve' } });
    expect(rejected.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(409);
  });
});
