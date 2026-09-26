import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const BOT_TOKEN = 'max-test-token';

function signedInitData(userId: number): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: userId, first_name: 'Анна', last_name: 'Тестова', username: `resident_${userId}` });
  const values: Array<[string, string]> = [['auth_date', String(authDate)], ['user', user]];
  const canonical = [...values]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(canonical).digest('hex');
  const params = new URLSearchParams(values);
  params.set('hash', hash);
  return params.toString();
}

describe.skipIf(!databaseUrl)('MAX authentication routes', () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE residents CASCADE');
    app = await buildApp({ pool, env: { NODE_ENV: 'test', BOT_TOKEN } });
  });

  afterEach(async () => {
    await app.close();
  });

  it('exchanges valid MAX initData for a hashed session and returns /api/me', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: signedInitData(90101) } });

    expect(login.statusCode).toBe(200);
    const session = login.json<{ token: string; expiresAt: string }>();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await pool.query<{ token_hash: Buffer; max_user_id: string }>(
      `SELECT s.token_hash, r.max_user_id FROM sessions s JOIN residents r ON r.id = s.resident_id WHERE r.max_user_id = $1`,
      ['90101'],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.token_hash).toEqual(createHash('sha256').update(session.token).digest());
    expect(JSON.stringify(stored.rows[0])).not.toContain(session.token);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${session.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      resident: { maxUserId: '90101', displayName: 'Анна Тестова', username: 'resident_90101' },
      memberships: [],
    });
    expect(me.body).not.toContain(session.token);
  });

  it('rejects forged initData and unknown bearer tokens', async () => {
    const tampered = new URLSearchParams(signedInitData(90102));
    tampered.set('user', JSON.stringify({ id: 90102, first_name: 'Подмена' }));
    const login = await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: tampered.toString() } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${'x'.repeat(43)}` } });

    expect(login.statusCode).toBe(401);
    expect(me.statusCode).toBe(401);
  });

  it('revokes an authenticated session on logout', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: signedInitData(90103) } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json<{ token: string }>();
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

    expect(logout.statusCode).toBe(204);
    expect(me.statusCode).toBe(401);
  });

  it('rejects expired stored sessions and a missing BOT_TOKEN configuration', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: signedInitData(90104) } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json<{ token: string }>();
    const tokenHash = createHash('sha256').update(token).digest();
    await pool.query(
      'UPDATE sessions SET created_at = $1, expires_at = $2 WHERE token_hash = $3',
      [new Date(Date.now() - 5000), new Date(Date.now() - 1000), tokenHash],
    );
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

    expect(me.statusCode).toBe(401);

    await app.close();
    app = await buildApp({ pool: createPool(databaseUrl!), env: { NODE_ENV: 'test' } });
    const unconfigured = await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: signedInitData(90105) } });
    expect(unconfigured.statusCode).toBe(503);
  });
});
