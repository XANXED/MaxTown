import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { HealthResponse } from '@maxtown/shared';
import { registerModeratorBasicAuth } from './auth/moderator-basic-auth.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHouseRoutes } from './routes/houses.ts';
import { registerModeratorRoutes } from './routes/moderator.ts';
import { registerCommunityRoutes } from './routes/community.ts';
import { registerRepairModeRoutes } from './routes/repair-mode.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerVkCallbackRoutes } from './routes/vk-callback.ts';
import { createPgOutboxStore, startNotificationOutboxWorker } from './notifications/outbox.ts';
import { createVkMessageClient } from './vk/client.ts';
import { registerServicesDirectoryRoutes } from './routes/services-directory.ts';

export type BuildAppOptions = {
  pool: Pool;
  env: NodeJS.ProcessEnv;
  staticAssets?: { miniAppRoot: string; adminRoot: string };
};

function isHtmlNavigation(request: { method: string; headers: { accept?: string } }, path: string): boolean {
  return request.method === 'GET'
    && request.headers.accept?.includes('text/html') === true
    && !path.split('/').some((segment) => segment.includes('.'));
}

export async function buildApp({ pool, env, staticAssets }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV === 'production' });
  const groupId = env.VK_GROUP_ID && /^\d+$/.test(env.VK_GROUP_ID) ? Number(env.VK_GROUP_ID) : null;
  const worker = groupId && env.VK_GROUP_TOKEN && env.VK_APP_ID
    ? startNotificationOutboxWorker(
      createPgOutboxStore(pool, Number(env.VK_APP_ID)),
      createVkMessageClient({ token: env.VK_GROUP_TOKEN, groupId, apiVersion: env.VK_API_VERSION }),
      { intervalMs: 15_000, setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    )
    : null;
  app.addHook('onClose', async () => {
    await worker?.stop();
    await pool.end();
  });

  registerModeratorBasicAuth(app, env);

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    app.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: 'internal_server_error' });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });
  app.get('/api/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });

  registerAuthRoutes(app, pool, env);
  registerHouseRoutes(app, pool);
  registerModeratorRoutes(app, pool);
  registerCommunityRoutes(app, pool, env.POLL_VOTER_NULLIFIER_SECRET ?? 'development-only-poll-voter-nullifier-secret');
  registerRepairModeRoutes(app, pool);
  registerServicesDirectoryRoutes(app, pool);
  registerNotificationRoutes(app, pool, groupId);
  if (groupId && env.VK_CALLBACK_SECRET && env.VK_CALLBACK_CONFIRMATION_CODE) {
    registerVkCallbackRoutes(app, pool, { groupId, secret: env.VK_CALLBACK_SECRET, confirmationCode: env.VK_CALLBACK_CONFIRMATION_CODE });
  }

  const assets = staticAssets ?? (env.NODE_ENV === 'production' ? {
    miniAppRoot: fileURLToPath(new URL('../../miniapp/dist', import.meta.url)),
    adminRoot: fileURLToPath(new URL('../../admin/dist', import.meta.url)),
  } : undefined);
  if (assets) {
    await app.register(fastifyStatic, {
      root: assets.miniAppRoot,
      prefix: '/',
      wildcard: false,
      dotfiles: 'deny',
    });
    await app.register(fastifyStatic, {
      root: assets.adminRoot,
      prefix: '/admin/',
      wildcard: false,
      decorateReply: false,
      dotfiles: 'deny',
    });

    app.get('/admin', async (_request, reply) => reply.redirect('/admin/', 308));
    app.get('/admin/*', async (request, reply) => {
      const path = request.raw.url?.split(/[?#]/, 1)[0] ?? '/admin/';
      if (!isHtmlNavigation(request, path)) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/html').sendFile('index.html', assets.adminRoot);
    });
    app.get('/*', async (request, reply) => {
      const path = request.raw.url?.split(/[?#]/, 1)[0] ?? '/';
      if (path === '/api' || path.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      if (!isHtmlNavigation(request, path)) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/html').sendFile('index.html', assets.miniAppRoot);
    });
  }

  return app;
}
