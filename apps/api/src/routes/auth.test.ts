import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const VK_APP_ID = '12345678';
const VK_APP_SECRET = 'vk-test-app-secret';

function signedLaunchParams(userId: string): string {
  const values = { vk_app_id: VK_APP_ID, vk_user_id: userId, vk_language: 'ru', vk_platform: 'android' };
  const canonical = Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return new URLSearchParams({ ...values, sign: createHmac('sha256', VK_APP_SECRET).update(canonical).digest('base64url') }).toString();
}

describe.skipIf(!databaseUrl)('VK authentication routes', () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE residents CASCADE');
    app = await buildApp({ pool, env: { NODE_ENV: 'test', VK_APP_ID, VK_APP_SECRET } });
  });

  afterEach(async () => { await app.close(); });

  it('exchanges a signed VK identity for a hashed server session and returns /api/me', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('90101') } });

    expect(login.statusCode).toBe(200);
    const session = login.json<{ token: string; expiresAt: string }>();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await pool.query<{ token_hash: Buffer; vk_user_id: string | null }>(
      `SELECT s.token_hash, r.vk_user_id FROM sessions s JOIN residents r ON r.id = s.resident_id WHERE r.vk_user_id = $1`,
      ['90101'],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.vk_user_id).toBe('90101');
    expect(stored.rows[0]!.token_hash).toEqual(createHash('sha256').update(session.token).digest());
    expect(JSON.stringify(stored.rows[0])).not.toContain(session.token);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${session.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ resident: { vkUserId: '90101', displayName: 'Жилец 90101' }, memberships: [] });
    expect(me.body).not.toContain(session.token);
  });

  it('rejects forged launch params and unknown bearer tokens', async () => {
    const tampered = new URLSearchParams(signedLaunchParams('90102'));
    tampered.set('vk_user_id', '999999');
    const login = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: tampered.toString() } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${'x'.repeat(43)}` } });

    expect(login.statusCode).toBe(401);
    expect(me.statusCode).toBe(401);
  });

  it('revokes an authenticated session on logout', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('90103') } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json<{ token: string }>();
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

    expect(logout.statusCode).toBe(204);
    expect(me.statusCode).toBe(401);
  });

  it('rejects expired stored sessions and missing VK app configuration', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('90104') } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json<{ token: string }>();
    const tokenHash = createHash('sha256').update(token).digest();
    await pool.query('UPDATE sessions SET created_at = $1, expires_at = $2 WHERE token_hash = $3', [new Date(Date.now() - 5000), new Date(Date.now() - 1000), tokenHash]);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(401);

    await app.close();
    app = await buildApp({ pool: createPool(databaseUrl!), env: { NODE_ENV: 'test' } });
    const unconfigured = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('90105') } });
    expect(unconfigured.statusCode).toBe(503);
  });
});
