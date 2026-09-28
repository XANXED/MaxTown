import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
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

it('migrates old votes to unlinkable aggregates and stores new ballots without identity columns', () => {
  const migrationUrl = new URL('./migrations/0004_anonymous_poll_ballots.sql', import.meta.url);
  const migration = readFileSync(migrationUrl, 'utf8');
  expect(migration).toContain('INSERT INTO poll_legacy_totals');
  expect(migration).toContain('GROUP BY poll_id, option_id');
  expect(migration).toContain('DROP TABLE poll_votes');
  const ballotDefinition = migration.split('CREATE TABLE poll_ballots (')[1]?.split(');')[0] ?? '';
  expect(ballotDefinition).toContain('poll_id uuid');
  expect(ballotDefinition).toContain('option_id uuid');
  expect(ballotDefinition).toContain('voter_nullifier bytea');
  expect(ballotDefinition).not.toMatch(/membership|resident|author/i);
  expect(ballotDefinition).toContain('PRIMARY KEY (poll_id, voter_nullifier)');
  expect(ballotDefinition).toContain('FOREIGN KEY (option_id, poll_id)');
});

it('defines per-resident consent, in-app poll notifications, and idempotent direct delivery records', () => {
  const migration = readFileSync(new URL('./migrations/0005_vk_notification_outbox.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE resident_message_permissions');
  expect(migration).toContain("status IN ('allowed', 'denied', 'opted_out')");
  expect(migration).toContain('CREATE TABLE vk_callback_events');
  expect(migration).toContain('event_id text PRIMARY KEY');
  expect(migration).toContain('CREATE TABLE in_app_notifications');
  expect(migration).toContain('UNIQUE (resident_id, poll_id)');
  expect(migration).toContain('CREATE TABLE vk_notification_outbox');
  expect(migration).toContain('UNIQUE (poll_id, membership_id)');
  expect(migration).toContain('provider_random_id integer GENERATED ALWAYS AS IDENTITY UNIQUE');
});

it.skipIf(!databaseUrl)('applies each SQL migration once and remains idempotent', async () => {
  expect(pool).not.toBeNull();
  if (!pool) return;

  await runMigrations(pool);
  await runMigrations(pool);

  const result = await pool.query<{ count: string }>('SELECT count(*) FROM schema_migrations');
  expect(result.rows[0]?.count).toBe('5');
});

it.skipIf(!databaseUrl)('preserves old public totals while deleting every historical voter link', async () => {
  const admin = createPool(databaseUrl!);
  const schema = `anonymous_migration_${randomUUID().replaceAll('-', '')}`;
  const scoped = new Pool({ connectionString: databaseUrl!, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await scoped.connect();
    try {
      for (const file of ['0001_core.sql', '0002_append_only_audit.sql', '0003_vk_identity.sql']) {
        await client.query(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
      }
      const inserted = await client.query<{ house_id: string; resident_id: string; membership_id: string; poll_id: string; option_id: string }>(`
        WITH resident AS (
          INSERT INTO residents (max_user_id, display_name) VALUES ('legacy-voter', 'Жилец') RETURNING id
        ), house AS (
          INSERT INTO houses (address, locality) VALUES ('ул. Историческая, 1', 'Казань') RETURNING id
        ), apartment AS (
          INSERT INTO apartments (house_id, number) SELECT id, '1' FROM house RETURNING id, house_id
        ), membership AS (
          INSERT INTO memberships (house_id, apartment_id, resident_id, role)
          SELECT apartment.house_id, apartment.id, resident.id, 'resident' FROM apartment, resident
          RETURNING id, house_id
        ), poll AS (
          INSERT INTO polls (house_id, author_membership_id, question)
          SELECT house_id, id, 'Старый опрос' FROM membership RETURNING id, house_id
        ), option_row AS (
          INSERT INTO poll_options (poll_id, label, position) SELECT id, 'Да', 1 FROM poll RETURNING id, poll_id
        ), old_vote AS (
          INSERT INTO poll_votes (house_id, poll_id, option_id, membership_id)
          SELECT membership.house_id, poll.id, option_row.id, membership.id
          FROM membership, poll, option_row RETURNING poll_id
        ) SELECT membership.house_id, resident.id AS resident_id, membership.id AS membership_id,
                 poll.id AS poll_id, option_row.id AS option_id
          FROM membership, resident, poll, option_row, old_vote`);
      expect(inserted.rows).toHaveLength(1);
      await client.query(readFileSync(new URL('./migrations/0004_anonymous_poll_ballots.sql', import.meta.url), 'utf8'));
      const legacy = await client.query('SELECT poll_id, option_id, votes FROM poll_legacy_totals');
      expect(legacy.rows).toHaveLength(1);
      expect(legacy.rows[0]).toMatchObject({ votes: '1' });
      const oldTable = await client.query("SELECT to_regclass('poll_votes') AS table_name");
      expect(oldTable.rows[0]?.table_name).toBeNull();
      const columns = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'poll_ballots'", [schema]);
      expect(columns.rows.map(({ column_name }) => column_name).sort()).toEqual(['option_id', 'poll_id', 'voter_nullifier']);
      const linkedForeignKeys = await client.query<{ count: string }>(`
        SELECT count(*) FROM information_schema.constraint_column_usage usage
         WHERE usage.constraint_schema = $1 AND usage.table_name = 'memberships'
           AND usage.constraint_name IN (
             SELECT constraint_name FROM information_schema.table_constraints
              WHERE table_schema = $1 AND table_name = 'poll_ballots' AND constraint_type = 'FOREIGN KEY'
           )`, [schema]);
      expect(linkedForeignKeys.rows[0]?.count).toBe('0');
    } finally {
      client.release();
    }
  } finally {
    await scoped.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
