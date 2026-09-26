import { existsSync, readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { runMigrations } from './migrate.ts';
import { createPool } from './pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : null;

afterAll(async () => {
  await pool?.end();
});

it('defines the core PostgreSQL schema migration', () => {
  const migrationUrl = new URL('./migrations/0001_core.sql', import.meta.url);

  expect(existsSync(migrationUrl)).toBe(true);
  if (!existsSync(migrationUrl)) return;

  const migration = readFileSync(migrationUrl, 'utf8');
  for (const table of [
    'residents',
    'houses',
    'apartments',
    'memberships',
    'invitations',
    'join_requests',
    'moderators',
    'house_registrations',
    'sessions',
    'community_messages',
    'polls',
    'poll_options',
    'poll_votes',
    'repair_modes',
    'audit_events',
  ]) {
    expect(migration).toContain(`CREATE TABLE ${table}`);
  }
  expect(migration).toContain('UNIQUE (poll_id, membership_id)');
  expect(migration).toContain("'headman', 'responsible', 'concierge', 'resident'");
});

it.skipIf(!databaseUrl)('applies each SQL migration once and remains idempotent', async () => {
  expect(pool).not.toBeNull();
  if (!pool) return;

  await runMigrations(pool);
  await runMigrations(pool);

  const result = await pool.query<{ count: string }>('SELECT count(*) FROM schema_migrations');
  expect(result.rows[0]?.count).toBe('2');
});
