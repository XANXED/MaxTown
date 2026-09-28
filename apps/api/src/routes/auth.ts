import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MeResponse } from '@maxtown/shared';
import { validateVkLaunchParams } from '../auth/vk-launch-params.ts';
import { createSession, requireAuthentication, revokeSession } from '../auth/sessions.ts';

type AuthBody = { launchParams: string };

type ResidentRow = {
  id: string;
};

export function registerAuthRoutes(app: FastifyInstance, pool: Pool, env: NodeJS.ProcessEnv): void {
  app.decorateRequest('authSession', null);
  app.decorateRequest('authToken', null);

  app.post<{ Body: AuthBody }>(
    '/api/auth/vk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['launchParams'],
          additionalProperties: false,
          properties: { launchParams: { type: 'string', minLength: 1, maxLength: 16_384 } },
        },
      },
    },
    async (request, reply) => {
      const appSecret = env.VK_APP_SECRET;
      const appId = env.VK_APP_ID;
      if (!appSecret?.trim() || !appId?.trim()) return reply.code(503).send({ error: 'authentication_unavailable' });

      let identity;
      try {
        identity = validateVkLaunchParams(request.body.launchParams, appSecret, appId);
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const resident = await pool.query<ResidentRow>(
        `INSERT INTO residents (vk_user_id, display_name, username)
         VALUES ($1, $2, NULL)
         ON CONFLICT (vk_user_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               updated_at = now()
         RETURNING id`,
        [identity.vkUserId, `Жилец ${identity.vkUserId}`],
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
