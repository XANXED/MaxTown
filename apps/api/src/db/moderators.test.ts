import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.ts';
import { createPool } from './pool.ts';
import { ensureBootstrapModerator } from './moderators.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('bootstrap Moderator', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE moderators CASCADE');
  });

  afterEach(async () => {
    await pool.end();
  });

  it('inserts a configured Moderator once', async () => {
    await ensureBootstrapModerator(pool, 'initial@example.org');
    await ensureBootstrapModerator(pool, 'initial@example.org');

    const result = await pool.query<{ principal: string }>(
      'SELECT principal FROM moderators WHERE principal = $1',
      ['initial@example.org'],
    );
    expect(result.rows).toEqual([{ principal: 'initial@example.org' }]);
  });

  it('does not re-enable a disabled bootstrap Moderator', async () => {
    await pool.query("INSERT INTO moderators (principal, disabled_at) VALUES ('disabled@example.org', now())");
    const before = await pool.query<{ disabled_at: Date }>(
      'SELECT disabled_at FROM moderators WHERE principal = $1',
      ['disabled@example.org'],
    );

    await ensureBootstrapModerator(pool, 'disabled@example.org');

    const after = await pool.query<{ disabled_at: Date }>(
      'SELECT disabled_at FROM moderators WHERE principal = $1',
      ['disabled@example.org'],
    );
    expect(after.rows[0]?.disabled_at).toEqual(before.rows[0]?.disabled_at);
  });
});
