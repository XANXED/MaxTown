import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

it('defines house scoped services and sourced tariffs', () => {
  const migration = readFileSync(new URL('./migrations/0006_house_service_directory.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE house_services');
  expect(migration).toContain('UNIQUE (id, house_id)');
  expect(migration).toContain('CREATE TABLE house_service_tariffs');
  expect(migration).toContain('source');
  expect(migration).toContain('checked_on');
  expect(migration).toContain('FOREIGN KEY (service_id, house_id)');
});

it('defines editable House Contacts and their import state', () => {
  const migration = readFileSync(new URL('./migrations/0007_house_contacts.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE house_contacts');
  expect(migration).toContain('CREATE TABLE house_contact_syncs');
  expect(migration).toContain("source IN ('manual', 'data-mos')");
  expect(migration).toContain('overridden_at');
  expect(migration).toContain('deleted_at');
  expect(migration).toContain('CREATE UNIQUE INDEX house_contacts_external_key');
  expect(migration).toContain("status IN ('ready', 'not-found', 'ambiguous', 'failed', 'not-configured', 'not-applicable')");
});

it('defines Assigned places kept by the House administrator', () => {
  const migration = readFileSync(new URL('./migrations/0008_house_assigned_places.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE house_assigned_places');
  expect(migration).toContain("'adult-clinic', 'children-clinic', 'womens-clinic', 'school', 'kindergarten'");
  expect(migration).toContain('deleted_at');
  // Ближайшие места из 2ГИС хранить нельзя (docs/adr/0008): таблицы под них нет.
  expect(migration).not.toMatch(/CREATE TABLE \w*nearest/);
});

it('stores a map point of an Assigned place only as a complete pair', () => {
  const migration = readFileSync(new URL('./migrations/0009_assigned_place_points.sql', import.meta.url), 'utf8');
  expect(migration).toContain('ADD COLUMN lat double precision');
  expect(migration).toContain('ADD COLUMN lon double precision');
  expect(migration).toContain('CHECK ((lat IS NULL) = (lon IS NULL))');
});

it('defines House-specific internet tariffs and one rating per membership', () => {
  const migration = readFileSync(new URL('./migrations/0010_house_internet_providers.sql', import.meta.url), 'utf8');
  expect(migration).toContain('ALTER TABLE house_service_tariffs');
  expect(migration).toContain('CREATE TABLE house_internet_provider_ratings');
  expect(migration).toContain('CHECK (score BETWEEN 1 AND 5)');
  expect(migration).toContain('PRIMARY KEY (service_id, membership_id)');
  expect(migration).toContain('FOREIGN KEY (membership_id, house_id)');
});

it('leaves provenance and sync state for a future provider import', () => {
  const migration = readFileSync(new URL('./migrations/0011_internet_provider_sources.sql', import.meta.url), 'utf8');
  expect(migration).toContain('source_external_id');
  expect(migration).toContain('manual_override');
  expect(migration).toContain('CREATE TABLE house_internet_provider_syncs');
  expect(migration).toContain("status IN ('not-configured', 'ready', 'running', 'failed')");
});

it('moves roles to MAX house chats: admin, resident, management company', () => {
  const migration = readFileSync(new URL('./migrations/0012_max_house_chats.sql', import.meta.url), 'utf8');
  expect(migration).toContain("CHECK (role IN ('admin', 'resident', 'management-company'))");
  expect(migration).toContain("WHEN 'headman' THEN 'admin'");
  expect(migration).toContain('CREATE TABLE house_chats');
  expect(migration).toContain('chat_id bigint PRIMARY KEY');
  expect(migration).toContain('house_id uuid NOT NULL UNIQUE');
  expect(migration).toContain('DROP CONSTRAINT IF EXISTS houses_address_locality_key');
  // Сессии, выданные по VK, после перехода недействительны.
  expect(migration).toContain('UPDATE sessions SET revoked_at = now()');
});

it('adds requests, «У меня тоже», accidents and request notifications', () => {
  const migration = readFileSync(new URL('./migrations/0013_requests_and_accidents.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE requests');
  expect(migration).toContain('CREATE TABLE request_supporters');
  expect(migration).toContain('CREATE TABLE accidents');
  // По одной Системе открыта не больше одной Аварии.
  expect(migration).toContain('CREATE UNIQUE INDEX accidents_one_open_per_system ON accidents (house_id, system) WHERE resolved_at IS NULL');
  expect(migration).toContain('ALTER COLUMN poll_id DROP NOT NULL');
  expect(migration).toContain("content_type IN ('image/jpeg', 'image/png', 'image/webp')");
});

it('adds request subcategories checked by code, not by a fixed list', () => {
  const migration = readFileSync(new URL('./migrations/0014_request_subcategories.sql', import.meta.url), 'utf8');
  expect(migration).toContain('ADD COLUMN subcategory text');
  expect(migration).toContain("subcategory ~ '^[a-z0-9-]{1,40}$'");
});

it('adds the apartment layout, apartment repairs, and targeted MAX delivery', () => {
  const migration = readFileSync(new URL('./migrations/0015_apartment_repairs.sql', import.meta.url), 'utf8');
  expect(migration).toContain('ADD COLUMN entrance integer');
  expect(migration).toContain('CREATE UNIQUE INDEX apartments_layout_cell');
  expect(migration).toContain('CREATE TABLE apartment_repairs');
  expect(migration).toContain('CREATE TABLE max_direct_message_outbox');
  expect(migration).toContain('apartment_repair_id uuid');
  expect(migration).toContain("kind = 'apartment-repair'");
});

it('adds public management questions, messages, photos and generic direct delivery', () => {
  const migration = readFileSync(new URL('./migrations/0016_management_questions.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE management_questions');
  expect(migration).toContain('CREATE TABLE management_question_messages');
  expect(migration).toContain('CREATE TABLE management_question_photos');
  expect(migration).toContain('CREATE TABLE management_question_state_changes');
  expect(migration).toContain("'management-question', 'management-answer'");
  expect(migration).toContain('ADD COLUMN button_payload text');
  expect(migration).toContain('CREATE UNIQUE INDEX max_direct_message_outbox_dedupe');
});

it('stores the first-run House profile on membership', () => {
  const migration = readFileSync(new URL('./migrations/0018_resident_house_profiles.sql', import.meta.url), 'utf8');
  expect(migration).toContain('phone_visible_to_neighbors boolean NOT NULL DEFAULT false');
  expect(migration).toContain('neighbor_apartment_left text');
  expect(migration).toContain('neighbor_apartment_right text');
  expect(migration).toContain('neighbor_apartment_below text');
  expect(migration).toContain('neighbor_apartment_above text');
  expect(migration).toContain('profile_completed_at timestamptz');
});

it('adds apartment-private utility payment schedules, receipts and reminders', () => {
  const migration = readFileSync(new URL('./migrations/0019_utility_payments.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE utility_payment_templates');
  expect(migration).toContain('CREATE TABLE utility_payment_periods');
  expect(migration).toContain('CREATE TABLE utility_payment_receipts');
  expect(migration).toContain('CREATE TABLE utility_payment_events');
  expect(migration).toContain("'utility-payment'");
  expect(migration).toContain("'three-days', 'due-today', 'overdue-once'");
  expect(migration).toContain('octet_length(data) BETWEEN 1 AND 5242880');
});

it('adds apartment-private meters and one current reading per month', () => {
  const migration = readFileSync(new URL('./migrations/0020_apartment_meter_readings.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE utility_meters');
  expect(migration).toContain('CREATE TABLE utility_meter_readings');
  expect(migration).toContain('UNIQUE (meter_id, reading_month)');
  expect(migration).toContain('submitted_by_membership_id');
  expect(migration).toContain('archived_at');
  expect(migration).toContain('CHECK (decimals BETWEEN 0 AND 3)');
});

it('adds planned outages and House announcements', () => {
  const migration = readFileSync(new URL('./migrations/0021_house_publications.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE house_publications');
  expect(migration).toContain("kind IN ('planned-outage', 'announcement')");
  expect(migration).toContain('published_by_membership_id');
  expect(migration).toContain("kind = 'planned-outage'");
  expect(migration).toContain('ends_at > starts_at');
});

it('adds Household-scoped apartment access and payment privacy', () => {
  const migration = readFileSync(new URL('./migrations/0022_apartment_households.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE apartment_households');
  expect(migration).toContain('apartment_household_id');
  expect(migration).toContain('UPDATE invitations SET revoked_at = now()');
  expect(migration).toContain("SET status = 'rejected'");
  expect(migration).toContain('floor BETWEEN 1 AND 200');
  expect(migration).toContain("'apartment-access-request'");
});

it('stores limited Apartment info invitations separately from Household membership', () => {
  const migration = readFileSync(new URL('./migrations/0023_apartment_info_access.sql', import.meta.url), 'utf8');
  expect(migration).toContain('CREATE TABLE apartment_info_invitations');
  expect(migration).toContain('CREATE TABLE apartment_info_access_grants');
  expect(migration).toContain('code_hash bytea NOT NULL UNIQUE');
  expect(migration).toContain("interval '7 days'");
  expect(migration).not.toContain('apartment_household_id');
});

it.skipIf(!databaseUrl)('applies each SQL migration once and remains idempotent', async () => {
  expect(pool).not.toBeNull();
  if (!pool) return;

  await runMigrations(pool);
  await runMigrations(pool);

  const result = await pool.query<{ count: string }>('SELECT count(*) FROM schema_migrations');
  expect(result.rows[0]?.count).toBe('23');
});

it.skipIf(!databaseUrl)('backfills active and closed Households without exposing old payment data', async () => {
  const admin = createPool(databaseUrl!);
  const schema = `household_migration_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.delete('options');
  const scoped = new Pool({ connectionString: scopedUrl.toString(), options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await scoped.connect();
    try {
      const files = readdirSync(new URL('./migrations/', import.meta.url))
        .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < '0022_')
        .sort();
      for (const file of files) await client.query(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
      const seeded = await client.query<{
        house_id: string; occupied_apartment_id: string; empty_apartment_id: string;
        membership_id: string; requester_id: string;
      }>(`
        WITH house AS (
          INSERT INTO houses (address, locality) VALUES ('ул. Миграционная, 1', 'Казань') RETURNING id
        ), occupied_apartment AS (
          INSERT INTO apartments (house_id, number) SELECT id, '1' FROM house RETURNING id, house_id
        ), empty_apartment AS (
          INSERT INTO apartments (house_id, number) SELECT id, '2' FROM house RETURNING id, house_id
        ), occupant AS (
          INSERT INTO residents (max_user_id, display_name) VALUES ('migration-occupant', 'Старый Жилец') RETURNING id
        ), requester AS (
          INSERT INTO residents (max_user_id, display_name) VALUES ('migration-requester', 'Заявитель') RETURNING id
        ), membership AS (
          INSERT INTO memberships (house_id, apartment_id, resident_id, role)
          SELECT occupied_apartment.house_id, occupied_apartment.id, occupant.id, 'resident'
            FROM occupied_apartment, occupant RETURNING id, house_id, apartment_id
        ), occupied_template AS (
          INSERT INTO utility_payment_templates
            (house_id, apartment_id, category, title, due_day, starts_on, created_by_membership_id, updated_by_membership_id)
          SELECT membership.house_id, occupied_apartment.id, 'water', 'Вода', 20, '2026-09-01', membership.id, membership.id
            FROM membership, occupied_apartment RETURNING id
        ), empty_template AS (
          INSERT INTO utility_payment_templates
            (house_id, apartment_id, category, title, due_day, starts_on, created_by_membership_id, updated_by_membership_id)
          SELECT membership.house_id, empty_apartment.id, 'rent', 'Старый платёж', 10, '2026-09-01', membership.id, membership.id
            FROM membership, empty_apartment RETURNING id
        ), invitation AS (
          INSERT INTO invitations (house_id, apartment_id, created_by_membership_id, code_hash)
          SELECT membership.house_id, occupied_apartment.id, membership.id, decode(md5('old-code'), 'hex')
            FROM membership, occupied_apartment RETURNING id
        ), request AS (
          INSERT INTO join_requests (house_id, apartment_id, resident_id)
          SELECT membership.house_id, occupied_apartment.id, requester.id
            FROM membership, occupied_apartment, requester RETURNING id
        )
        SELECT membership.house_id, occupied_apartment.id AS occupied_apartment_id,
               empty_apartment.id AS empty_apartment_id, membership.id AS membership_id,
               requester.id AS requester_id
          FROM membership, occupied_apartment, empty_apartment, requester,
               occupied_template, empty_template, invitation, request`);
      expect(seeded.rows).toHaveLength(1);
      await client.query(readFileSync(new URL('./migrations/0022_apartment_households.sql', import.meta.url), 'utf8'));

      const households = await client.query<{ apartment_id: string; ended_at: Date | null }>(
        'SELECT apartment_id, ended_at FROM apartment_households ORDER BY apartment_id',
      );
      expect(households.rows).toHaveLength(2);
      expect(households.rows.find((row) => row.apartment_id === seeded.rows[0]!.occupied_apartment_id)?.ended_at).toBeNull();
      expect(households.rows.find((row) => row.apartment_id === seeded.rows[0]!.empty_apartment_id)?.ended_at).toBeInstanceOf(Date);
      expect((await client.query('SELECT 1 FROM utility_payment_templates WHERE apartment_household_id IS NULL')).rowCount).toBe(0);
      expect((await client.query('SELECT 1 FROM memberships WHERE id = $1 AND apartment_household_id IS NOT NULL', [seeded.rows[0]!.membership_id])).rowCount).toBe(1);
      expect((await client.query('SELECT 1 FROM invitations WHERE revoked_at IS NOT NULL')).rowCount).toBe(1);
      expect((await client.query("SELECT 1 FROM join_requests WHERE status = 'rejected' AND decided_at IS NOT NULL")).rowCount).toBe(1);
      await client.query('UPDATE apartments SET floor = 7 WHERE id = $1', [seeded.rows[0]!.occupied_apartment_id]);
      await expect(client.query('UPDATE apartments SET layout_column = 1 WHERE id = $1', [seeded.rows[0]!.occupied_apartment_id])).rejects.toMatchObject({ code: '23514' });
    } finally {
      client.release();
    }
  } finally {
    await scoped.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

it.skipIf(!databaseUrl)('preserves old public totals while deleting every historical voter link', async () => {
  const admin = createPool(databaseUrl!);
  const schema = `anonymous_migration_${randomUUID().replaceAll('-', '')}`;
  // TEST_DATABASE_URL обычно уже содержит options с тестовой search_path.
  // Убираем её из URL, чтобы явная случайная схема этого теста имела приоритет.
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.delete('options');
  const scoped = new Pool({ connectionString: scopedUrl.toString(), options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await scoped.connect();
    try {
      for (const file of ['0001_core.sql', '0002_immutable_audit_events.sql', '0003_vk_identity.sql']) {
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
