import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';

const VK_APP_ID = '12345678';
const VK_APP_SECRET = 'vk-test-client-secret';

function signedLaunchParams(userId: string): string {
  const values = { vk_app_id: VK_APP_ID, vk_user_id: userId, vk_language: 'ru', vk_platform: 'android' };
  const canonical = Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return new URLSearchParams({ ...values, sign: createHmac('sha256', VK_APP_SECRET).update(canonical).digest('base64url') }).toString();
}

describe('VK authentication route', () => {
  const apps: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createHarness(env: NodeJS.ProcessEnv = { NODE_ENV: 'test', VK_APP_ID, VK_APP_SECRET }) {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('INSERT INTO residents')) return { rows: [{ id: 'resident-1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO sessions')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const pool = { query, end: vi.fn(async () => undefined) } as unknown as Pool;
    const ready = buildApp({ pool, env, staticAssets: { miniAppRoot: '/missing/miniapp', adminRoot: '/missing/admin' } });
    const appPromise = ready.then((app) => { apps.push(app); return app; });
    return { appPromise, query };
  }

  it('rejects tampered launch parameters before creating a resident or session', async () => {
    const harness = createHarness();
    const app = await harness.appPromise;
    const launchParams = new URLSearchParams(signedLaunchParams('494075'));
    launchParams.set('vk_user_id', '999999');

    const response = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: launchParams.toString() } });

    expect(response.statusCode).toBe(401);
    expect(harness.query).not.toHaveBeenCalled();
  });

  it('creates a hashed server session only for the VK identity verified by the signature', async () => {
    const harness = createHarness();
    const app = await harness.appPromise;

    const response = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('494075') } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const residentInsert = harness.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO residents'));
    expect(residentInsert?.[0]).toContain('vk_user_id');
    expect(residentInsert?.[1]).toContain('494075');
    expect(residentInsert?.[1]).not.toContain('999999');
    expect(harness.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO sessions'))).toBe(true);
  });

  it('reports unavailable auth configuration without touching the database', async () => {
    const harness = createHarness({ NODE_ENV: 'test' });
    const app = await harness.appPromise;
    const response = await app.inject({ method: 'POST', url: '/api/auth/vk', payload: { launchParams: signedLaunchParams('494075') } });

    expect(response.statusCode).toBe(503);
    expect(harness.query).not.toHaveBeenCalled();
  });
});
