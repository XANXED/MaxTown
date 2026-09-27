import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('Fastify static app hosting', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const password = 'moderator-test-password';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'maxtown-static-'));
    const miniAppRoot = join(root, 'miniapp');
    const adminRoot = join(root, 'admin');
    await mkdir(join(miniAppRoot, 'assets'), { recursive: true });
    await mkdir(join(adminRoot, 'assets'), { recursive: true });
    await writeFile(join(miniAppRoot, 'index.html'), '<main>Mini App fixture</main>');
    await writeFile(join(miniAppRoot, 'assets', 'main.js'), 'window.app = "mini";');
    await writeFile(join(miniAppRoot, '.env'), 'secret=hidden');
    await writeFile(join(adminRoot, 'index.html'), '<main>Moderator fixture</main>');
    await writeFile(join(adminRoot, 'assets', 'admin.js'), 'window.app = "admin";');
    await writeFile(join(adminRoot, '.env'), 'secret=hidden');
    const pool = {
      query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }),
      end: async () => undefined,
    } as unknown as Pool;
    app = await buildApp({
      pool,
      env: {
        NODE_ENV: 'test',
        MODERATOR_USERNAME: 'moderator@example.org',
        MODERATOR_PASSWORD_HASH: await bcrypt.hash(password, 4),
      },
      staticAssets: { miniAppRoot, adminRoot },
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('serves the Mini App index, assets, and HTML navigation fallback', async () => {
    const index = await app.inject({ url: '/' });
    const asset = await app.inject({ url: '/assets/main.js' });
    const navigation = await app.inject({ url: '/houses/123', headers: { accept: 'text/html' } });

    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Mini App fixture');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('window.app = "mini"');
    expect(navigation.statusCode).toBe(200);
    expect(navigation.body).toContain('Mini App fixture');
  });

  it('returns 404 for missing assets and denies Mini App dotfiles', async () => {
    const missing = await app.inject({ url: '/assets/missing.js' });
    const dotfile = await app.inject({ url: '/.env' });

    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain('Mini App fixture');
    expect(dotfile.statusCode).toBe(404);
    expect(dotfile.body).not.toContain('secret=hidden');
  });

  it('protects the Admin app and assets, serves its SPA route, and denies dotfiles', async () => {
    const unauthorized = await app.inject({ url: '/admin/' });
    const authorization = `Basic ${Buffer.from(`moderator@example.org:${password}`).toString('base64')}`;
    const index = await app.inject({ url: '/admin/', headers: { authorization } });
    const asset = await app.inject({ url: '/admin/assets/admin.js', headers: { authorization } });
    const navigation = await app.inject({ url: '/admin/registrations', headers: { authorization, accept: 'text/html' } });
    const dotfile = await app.inject({ url: '/admin/.env', headers: { authorization } });

    expect(unauthorized.statusCode).toBe(401);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Moderator fixture');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('window.app = "admin"');
    expect(navigation.statusCode).toBe(200);
    expect(navigation.body).toContain('Moderator fixture');
    expect(dotfile.statusCode).toBe(404);
    expect(dotfile.body).not.toContain('secret=hidden');
  });

  it('does not turn unknown API routes into Mini App HTML', async () => {
    const response = await app.inject({ url: '/api/not-a-route', headers: { accept: 'text/html' } });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).not.toContain('Mini App fixture');
  });
});
