import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { runMigrations } from './migrate.ts';
import { createPool } from './pool.ts';
const databaseUrl = process.env.TEST_DATABASE_URL;
const databasePool = databaseUrl ? createPool(databaseUrl) : null;

it.skipIf(!databaseUrl)('serves liveness and readiness then closes its pool', async () => {
  expect(databasePool).not.toBeNull();
  if (!databasePool) return;

  await runMigrations(databasePool);
  const app = await buildApp({ pool: databasePool, env: process.env });
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok' });
  } finally {
    await app.close();
  }
});

it('returns not ready when the database is unavailable and closes its pool', async () => {
  const end = vi.fn(async () => undefined);
  const unavailablePool = {
    query: vi.fn(async () => {
      throw new Error('connection refused');
    }),
    end,
  } as unknown as Pool;
  const app = await buildApp({ pool: unavailablePool, env: {} });

  const ready = await app.inject({ method: 'GET', url: '/ready' });

  expect(ready.statusCode).toBe(503);
  expect(ready.json()).toEqual({ status: 'error' });
  await app.close();
  expect(end).toHaveBeenCalledOnce();
});
