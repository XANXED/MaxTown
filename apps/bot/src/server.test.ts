import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeServer } from './server.ts';

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixtureServer(): Promise<{ origin: string; root: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'maxtown-render-'));
  const root = join(directory, 'public');
  temporaryDirectories.push(directory);
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<main>Mini App</main>');
  await writeFile(join(root, 'assets', 'icon.svg'), '<svg></svg>');
  await writeFile(join(directory, 'secret.txt'), 'must not be served');

  const server = createNodeServer({
    env: { BOT_TOKEN: '', MAX_WEBHOOK_SECRET: '' },
    distDirectory: root,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Node server did not bind a TCP port');
  return { origin: `http://127.0.0.1:${address.port}`, root };
}

describe('Render Node host', () => {
  it('forwards health requests to the MAX API handler', async () => {
    const { origin } = await createFixtureServer();
    const response = await fetch(`${origin}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('serves built assets and falls back to the Mini App for client routes', async () => {
    const { origin } = await createFixtureServer();
    const asset = await fetch(`${origin}/assets/icon.svg`);
    const route = await fetch(`${origin}/houses/house-1`);

    expect(asset.headers.get('content-type')).toContain('image/svg+xml');
    await expect(asset.text()).resolves.toBe('<svg></svg>');
    await expect(route.text()).resolves.toBe('<main>Mini App</main>');
  });

  it('never serves files outside the built Mini App directory', async () => {
    const { origin } = await createFixtureServer();
    const response = await fetch(`${origin}/%2e%2e%2fsecret.txt`);

    expect(await response.text()).not.toContain('must not be served');
  });
});
