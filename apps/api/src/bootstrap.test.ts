import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.ts';
import { registerShutdownHandlers, startServer, type StartupDependencies } from './bootstrap.ts';

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://maxtown:test@localhost/maxtown',
  VK_APP_ID: '12345678',
  VK_APP_SECRET: 'vk-test-app-secret',
  MODERATOR_USERNAME: 'moderator@example.org',
  MODERATOR_PASSWORD_HASH: `$2a$04$${'A'.repeat(53)}`,
};

function createDependencies(order: string[] = []) {
  const pool = {
    query: vi.fn(async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 })),
    end: vi.fn(async () => { order.push('pool.end'); }),
  } as unknown as Pool;
  const app = Fastify();
  app.addHook('onClose', async () => { await pool.end(); });
  const dependencies: StartupDependencies = {
    createPool: vi.fn(() => { order.push('pool.create'); return pool; }),
    runMigrations: vi.fn(async () => { order.push('migrations'); }),
    ensureBootstrapModerator: vi.fn(async (_pool, principal) => { order.push(`moderator:${principal}`); }),
    buildApp: vi.fn(async () => { order.push('app.build'); return app; }),
    listen: vi.fn(async (_app, address) => { order.push(`listen:${address.host}:${address.port}`); }),
  };
  return { app, pool, dependencies };
}

describe('API startup', () => {
  let activeApp: FastifyInstance | undefined;

  afterEach(async () => {
    if (activeApp) await activeApp.close();
    activeApp = undefined;
  });

  it('runs migrations and Moderator bootstrap before listening on Render PORT', async () => {
    const order: string[] = [];
    const { app, dependencies } = createDependencies(order);
    activeApp = app;

    await startServer({ env: { ...validProductionEnv, PORT: '10000', API_PORT: '3000' }, dependencies });

    expect(order).toEqual([
      'pool.create', 'migrations', 'moderator:moderator@example.org', 'app.build', 'listen:0.0.0.0:10000',
    ]);
  });

  it('closes the database pool and never listens when migration fails', async () => {
    const order: string[] = [];
    const { pool, dependencies } = createDependencies(order);
    dependencies.runMigrations = vi.fn(async () => { order.push('migrations'); throw new Error('migration failed'); });

    await expect(startServer({ env: validProductionEnv, dependencies })).rejects.toThrow('migration failed');

    expect(order).toEqual(['pool.create', 'migrations', 'pool.end']);
    expect(dependencies.listen).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('rejects missing production secrets before creating the pool', async () => {
    const { dependencies } = createDependencies();

    await expect(startServer({ env: { ...validProductionEnv, VK_APP_SECRET: '' }, dependencies })).rejects.toThrow(/VK_APP_SECRET/);

    expect(dependencies.createPool).not.toHaveBeenCalled();
    expect(dependencies.listen).not.toHaveBeenCalled();
  });

  it('uses API_PORT when PORT is absent and defaults to 3000', async () => {
    const apiPortDeps = createDependencies();
    activeApp = apiPortDeps.app;
    await startServer({ env: { ...validProductionEnv, API_PORT: '4500' }, dependencies: apiPortDeps.dependencies });
    expect(apiPortDeps.dependencies.listen).toHaveBeenCalledWith(apiPortDeps.app, { host: '0.0.0.0', port: 4500 });
    await apiPortDeps.app.close();
    activeApp = undefined;

    const defaultDeps = createDependencies();
    activeApp = defaultDeps.app;
    await startServer({ env: validProductionEnv, dependencies: defaultDeps.dependencies });
    expect(defaultDeps.dependencies.listen).toHaveBeenCalledWith(defaultDeps.app, { host: '0.0.0.0', port: 3000 });
  });

  it.each(['0', '65536', '1.5', 'bad'])('rejects invalid port %s before creating a pool', async (PORT) => {
    const { dependencies } = createDependencies();

    await expect(startServer({ env: { ...validProductionEnv, PORT }, dependencies })).rejects.toThrow(/port/i);

    expect(dependencies.createPool).not.toHaveBeenCalled();
  });

  it('returns 503 from readiness while the database is unavailable', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('database unavailable'); }),
      end: vi.fn(async () => undefined),
    } as unknown as Pool;
    const app = await buildApp({ pool, env: { NODE_ENV: 'test' }, staticAssets: {
      miniAppRoot: '/missing/miniapp', adminRoot: '/missing/admin',
    } });
    activeApp = app;

    const response = await app.inject({ url: '/api/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error' });
  });

  it('closes Fastify only once when both shutdown signals fire', async () => {
    const app = Fastify();
    const close = vi.spyOn(app, 'close').mockResolvedValue(undefined);
    const listeners = new Map<string, () => void>();
    const signals = { once: (signal: string, listener: () => void) => { listeners.set(signal, listener); } };
    registerShutdownHandlers(app, signals);

    listeners.get('SIGTERM')!();
    listeners.get('SIGINT')!();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
