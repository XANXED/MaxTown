import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { HealthResponse } from '@maxtown/shared';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHouseRoutes } from './routes/houses.ts';
import { registerModeratorRoutes } from './routes/moderator.ts';

export type BuildAppOptions = {
  pool: Pool;
  env: NodeJS.ProcessEnv;
};

export async function buildApp({ pool, env }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV === 'production' });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    app.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: 'internal_server_error' });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
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

  return app;
}
