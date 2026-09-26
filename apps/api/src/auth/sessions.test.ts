import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const sessionsModule = await import('./sessions.ts').catch(() => null);
const databaseUrl = process.env.TEST_DATABASE_URL;

describe('server-side sessions', () => {
  it('exposes creation, lookup, and revocation operations', () => {
    expect(typeof sessionsModule?.createSession).toBe('function');
    expect(typeof sessionsModule?.getSession).toBe('function');
    expect(typeof sessionsModule?.revokeSession).toBe('function');
  });

  describe.skipIf(!databaseUrl)('PostgreSQL session lifecycle', () => {
    let pool: ReturnType<typeof createPool>;
    let residentId: string;

    beforeEach(async () => {
      pool = createPool(databaseUrl!);
      await runMigrations(pool);
      await pool.query('TRUNCATE TABLE residents CASCADE');
      const resident = await pool.query<{ id: string }>(
        `INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id`,
        ['session-test-resident', 'Тестовый Жилец'],
      );
      residentId = resident.rows[0]!.id;
    });

    afterEach(async () => {
      await pool.end();
    });

    it('persists only a token hash, enforces expiry, and revokes the session', async () => {
      const createSession = sessionsModule?.createSession;
      const getSession = sessionsModule?.getSession;
      const revokeSession = sessionsModule?.revokeSession;
      expect(createSession).toBeTypeOf('function');
      expect(getSession).toBeTypeOf('function');
      expect(revokeSession).toBeTypeOf('function');
      if (!createSession || !getSession || !revokeSession) return;

      const createdAt = new Date('2026-09-26T12:00:00.000Z');
      const now = new Date(createdAt.getTime() + 1000);
      const session = await createSession(pool, residentId, createdAt);
      expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.expiresAt.getTime()).toBeGreaterThan(now.getTime());

      const stored = await pool.query<{ token_hash: Buffer }>(
        'SELECT token_hash FROM sessions WHERE resident_id = $1',
        [residentId],
      );
      const expectedHash = createHash('sha256').update(session.token).digest();
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]!.token_hash).toEqual(expectedHash);
      expect(stored.rows[0]!.token_hash.toString()).not.toContain(session.token);
      expect((await getSession(pool, session.token, now))?.resident.id).toBe(residentId);

      await pool.query('UPDATE sessions SET expires_at = $1 WHERE token_hash = $2', [new Date(now.getTime() - 500), expectedHash]);
      expect(await getSession(pool, session.token, now)).toBeNull();

      await revokeSession(pool, session.token, now);
      expect(await getSession(pool, session.token, now)).toBeNull();
    });
  });
});
