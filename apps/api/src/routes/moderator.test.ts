import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const moderatorUsername = 'moderator@example.org';
const moderatorPassword = 'moderator-test-password';

function basicAuth(username = moderatorUsername, password = moderatorPassword): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe.skipIf(!databaseUrl)('moderator registration routes', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let registrationId: string;
  let moderatorPasswordHash: string;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    moderatorPasswordHash = await bcrypt.hash(moderatorPassword, 4);
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
    app = await buildApp({ pool, env: {
      NODE_ENV: 'test',
      MODERATOR_USERNAME: moderatorUsername,
      MODERATOR_PASSWORD_HASH: moderatorPasswordHash,
    } });
  });

  afterEach(async () => { if (app) await app.close(); });

  it('rejects missing, unknown, and disabled moderator principals', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations', headers: { 'x-maxtown-moderator': 'attacker' } })).statusCode).toBe(401);
    await pool.query("UPDATE moderators SET disabled_at = now() WHERE principal = 'moderator@example.org'");
    expect((await app.inject({ method: 'GET', url: '/api/moderator/registrations', headers: { authorization: basicAuth() } })).statusCode).toBe(401);
    const unknownPool = createPool(databaseUrl!);
    await runMigrations(unknownPool);
    const unknownApp = await buildApp({ pool: unknownPool, env: {
      NODE_ENV: 'test',
      MODERATOR_USERNAME: 'unknown@example.org',
      MODERATOR_PASSWORD_HASH: moderatorPasswordHash,
    } });
    try {
      expect((await unknownApp.inject({ method: 'GET', url: '/api/moderator/registrations', headers: { authorization: basicAuth('unknown@example.org') } })).statusCode).toBe(401);
    } finally {
      await unknownApp.close();
    }
  });

  it('uses the Basic-auth principal and ignores a spoofed identity header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/moderator/registrations?status=pending',
      headers: { authorization: basicAuth(), 'x-maxtown-moderator': 'attacker' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ registrations: Array<{ id: string }> }>().registrations[0]?.id).toBe(registrationId);
  });

  it('approves a registration, creates the House and headman membership, and records the authenticated principal', async () => {
    const headers = { authorization: basicAuth() };
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
    const headers = { authorization: basicAuth() };
    const invalid = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'reject', reason: 'нет' } });
    expect(invalid.statusCode).toBe(400);
    const rejected = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'reject', reason: 'Адрес не совпадает' } });
    const repeated = await app.inject({ method: 'POST', url: `/api/moderator/registrations/${registrationId}/decision`, headers, payload: { decision: 'approve' } });
    expect(rejected.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(409);
  });
});
