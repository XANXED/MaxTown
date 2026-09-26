import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type Pool as PgPool } from 'pg';

const migrationLockId = 4_826_219;
const migrationsDirectory = new URL('./migrations/', import.meta.url);

export async function runMigrations(pool: PgPool): Promise<void> {
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (applied.rowCount) continue;

      const sql = await readFile(new URL(file, migrationsDirectory), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
  } catch (error) {
    console.error('Database migration failed');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
