import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MeResponse } from '@maxtown/shared';
import { validateMaxInitData } from '../auth/max-init-data.ts';
import { createSession, requireAuthentication, revokeSession } from '../auth/sessions.ts';

type AuthBody = { initData: string };

type ResidentRow = {
  id: string;
};

export function registerAuthRoutes(app: FastifyInstance, pool: Pool, env: NodeJS.ProcessEnv): void {
  app.decorateRequest('authSession', null);
  app.decorateRequest('authToken', null);

  app.post<{ Body: AuthBody }>(
    '/api/auth/max',
    {
      schema: {
        body: {
          type: 'object',
          required: ['initData'],
          additionalProperties: false,
          properties: { initData: { type: 'string', minLength: 1, maxLength: 16_384 } },
        },
      },
    },
    async (request, reply) => {
      const botToken = env.BOT_TOKEN;
      if (!botToken?.trim()) return reply.code(503).send({ error: 'authentication_unavailable' });

      let identity;
      try {
        identity = validateMaxInitData(request.body.initData, botToken);
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const resident = await pool.query<ResidentRow>(
        `INSERT INTO residents (max_user_id, display_name, username)
         VALUES ($1, $2, $3)
         ON CONFLICT (max_user_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               username = EXCLUDED.username,
               updated_at = now()
         RETURNING id`,
        [identity.maxUserId, [identity.firstName, identity.lastName].filter(Boolean).join(' '), identity.username],
      );
      const session = await createSession(pool, resident.rows[0]!.id);
      return { token: session.token, expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.post('/api/auth/logout', { preHandler: requireAuthentication(pool) }, async (request, reply) => {
    await revokeSession(pool, request.authToken!);
    return reply.code(204).send();
  });

  app.get<{ Reply: MeResponse }>(
    '/api/me',
    { preHandler: requireAuthentication(pool) },
    async (request) => ({
      resident: request.authSession!.resident,
      memberships: request.authSession!.memberships,
    }),
  );
}
