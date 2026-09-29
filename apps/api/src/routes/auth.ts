import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MaxAuthSessionResponse, MeResponse } from '@maxtown/shared';
import { validateMaxInitData } from '../auth/max-init-data.ts';
import { createSession, requireAuthentication, revokeSession } from '../auth/sessions.ts';
import { syncResidentHouses, type HouseChatDeps } from '../max/house-chats.ts';

type AuthBody = { initData: string; chatId?: number };

type ResidentRow = {
  id: string;
};

export type AuthConfig = {
  /** Токен бота MAX: им подписан initData. Без него вход выключен. */
  botToken: string | null;
  initDataTtlSeconds: number;
  houseChats: HouseChatDeps | null;
};

export function registerAuthRoutes(app: FastifyInstance, pool: Pool, config: AuthConfig): void {
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
          properties: {
            initData: { type: 'string', minLength: 1, maxLength: 16_384 },
            // Чат из параметра запуска (кнопка «Указать адрес») — только подсказка,
            // права всё равно проверяются через MAX.
            chatId: { type: 'integer', not: { const: 0 } },
          },
        },
      },
    },
    async (request, reply): Promise<MaxAuthSessionResponse | undefined> => {
      if (!config.botToken) return reply.code(503).send({ error: 'authentication_unavailable' });

      const validation = validateMaxInitData(request.body.initData, config.botToken, { maxAgeSeconds: config.initDataTtlSeconds });
      if (!validation.ok) return reply.code(401).send({ error: 'unauthorized' });

      const { user } = validation.data;
      const resident = await pool.query<ResidentRow>(
        `INSERT INTO residents (max_user_id, display_name, username)
         VALUES ($1, $2, $3)
         ON CONFLICT (max_user_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               username = EXCLUDED.username,
               updated_at = now()
         RETURNING id`,
        [String(user.id), [user.firstName, user.lastName].filter(Boolean).join(' '), user.username ?? null],
      );
      const residentId = resident.rows[0]!.id;
      // Дома и Роли — по текущему участию в Домовых чатах.
      const pendingHouseSetups = config.houseChats
        ? await syncResidentHouses(config.houseChats, { id: residentId, maxUserId: user.id }, request.body.chatId ?? null)
        : [];
      const session = await createSession(pool, residentId);
      return { token: session.token, expiresAt: session.expiresAt.toISOString(), pendingHouseSetups };
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
