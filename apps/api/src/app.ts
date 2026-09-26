import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { HealthResponse } from '@maxtown/shared';

export type BuildAppOptions = {
  pool: Pool;
  env: NodeJS.ProcessEnv;
};

export async function buildApp({ pool, env }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV === 'production' });

  app.addHook('onClose', async () => {
    await pool.end();
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

  return app;
}
