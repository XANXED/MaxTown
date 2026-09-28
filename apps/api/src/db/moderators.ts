import type { Pool } from 'pg';

export async function ensureBootstrapModerator(pool: Pool, principal: string): Promise<void> {
  await pool.query(
    'INSERT INTO moderators (principal) VALUES ($1) ON CONFLICT (principal) DO NOTHING',
    [principal],
  );
}
