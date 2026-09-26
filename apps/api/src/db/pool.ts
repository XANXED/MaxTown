import { Pool } from 'pg';

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}
