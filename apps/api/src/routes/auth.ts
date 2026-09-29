import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MaxAuthSessionResponse, MeResponse, NeighborApartments, ResidentHouseProfileInput } from '@maxtown/shared';
import { validateMaxInitData } from '../auth/max-init-data.ts';
import { validateMaxContact } from '../auth/max-contact.ts';
import { createSession, getSession, requireAuthentication, revokeSession } from '../auth/sessions.ts';
import { syncResidentHouses, type HouseChatDeps } from '../max/house-chats.ts';

type AuthBody = { initData: string; chatId?: number };

type ResidentRow = {
  id: string;
};

type ProfileParams = { houseId: string };
type ProfileMembershipRow = {
  membership_id: string;
  max_user_id: string | null;
  phone: string | null;
  phone_verified: boolean;
};

const APARTMENT_NUMBER_PATTERN = /^[1-9][0-9]{0,3}[а-яa-z]?$/iu;

function normalizeApartmentNumber(value: string): string | null {
  const normalized = value.trim().toLocaleUpperCase('ru-RU');
  return APARTMENT_NUMBER_PATTERN.test(normalized) ? normalized : null;
}

function normalizeNeighborApartments(value: NeighborApartments): NeighborApartments | null {
  const normalize = (item: string | null): string | null | undefined => {
    if (item === null || !item.trim()) return null;
    return normalizeApartmentNumber(item) ?? undefined;
  };
  const left = normalize(value.left);
  const right = normalize(value.right);
  const below = normalize(value.below);
  const above = normalize(value.above);
  if ([left, right, below, above].includes(undefined)) return null;
  return { left: left!, right: right!, below: below!, above: above! };
}

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

  app.put<{ Params: ProfileParams; Body: ResidentHouseProfileInput; Reply: MeResponse }>(
    '/api/me/houses/:houseId/profile',
    {
      preHandler: requireAuthentication(pool),
      schema: {
        params: {
          type: 'object',
          required: ['houseId'],
          additionalProperties: false,
          properties: { houseId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['apartmentNumber', 'phoneVisibleToNeighbors', 'neighborApartments'],
          additionalProperties: false,
          properties: {
            apartmentNumber: { type: 'string', minLength: 1, maxLength: 5 },
            phoneVisibleToNeighbors: { type: 'boolean' },
            neighborApartments: {
              type: 'object',
              required: ['left', 'right', 'below', 'above'],
              additionalProperties: false,
              properties: {
                left: { type: ['string', 'null'], maxLength: 5 },
                right: { type: ['string', 'null'], maxLength: 5 },
                below: { type: ['string', 'null'], maxLength: 5 },
                above: { type: ['string', 'null'], maxLength: 5 },
              },
            },
            phoneContact: {
              type: 'object',
              required: ['phone', 'authDate', 'hash'],
              additionalProperties: false,
              properties: {
                phone: { type: 'string', minLength: 8, maxLength: 16 },
                authDate: { type: 'string', minLength: 1, maxLength: 13 },
                hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const apartmentNumber = normalizeApartmentNumber(request.body.apartmentNumber);
      const neighbors = normalizeNeighborApartments(request.body.neighborApartments);
      if (!apartmentNumber || !neighbors) return reply.code(400).send({ error: 'invalid_apartment_number' } as never);
      if (Object.values(neighbors).some((number) => number === apartmentNumber)) {
        return reply.code(400).send({ error: 'neighbor_matches_apartment' } as never);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const membership = await client.query<ProfileMembershipRow>(
          `SELECT m.id AS membership_id, r.max_user_id, r.phone, r.phone_verified
             FROM memberships m
             JOIN residents r ON r.id = m.resident_id
            WHERE m.house_id = $1 AND m.resident_id = $2 AND m.ended_at IS NULL
            FOR UPDATE OF m, r`,
          [request.params.houseId, request.authSession!.resident.id],
        );
        const current = membership.rows[0];
        if (!current) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'house_membership_not_found' } as never);
        }

        let verifiedPhone: string | null = null;
        if (request.body.phoneVisibleToNeighbors && (!current.phone_verified || !current.phone)) {
          if (!config.botToken) {
            await client.query('ROLLBACK');
            return reply.code(503).send({ error: 'phone_verification_unavailable' } as never);
          }
          if (!request.body.phoneContact || !current.max_user_id) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: 'phone_contact_required' } as never);
          }
          const contact = validateMaxContact(request.body.phoneContact, current.max_user_id, config.botToken, {
            maxAgeSeconds: config.initDataTtlSeconds,
          });
          if (!contact.ok) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: 'invalid_phone_contact' } as never);
          }
          verifiedPhone = contact.phone;
        }

        if (verifiedPhone) {
          await client.query(
            'UPDATE residents SET phone = $2, phone_verified = true, updated_at = now() WHERE id = $1',
            [request.authSession!.resident.id, verifiedPhone],
          );
        }
        const apartment = await client.query<{ id: string }>(
          `INSERT INTO apartments (house_id, number) VALUES ($1, $2)
           ON CONFLICT (house_id, number) DO UPDATE SET number = EXCLUDED.number
           RETURNING id`,
          [request.params.houseId, apartmentNumber],
        );
        await client.query(
          `UPDATE memberships
              SET apartment_id = $2,
                  phone_visible_to_neighbors = $3,
                  neighbor_apartment_left = $4,
                  neighbor_apartment_right = $5,
                  neighbor_apartment_below = $6,
                  neighbor_apartment_above = $7,
                  profile_completed_at = now()
            WHERE id = $1`,
          [current.membership_id, apartment.rows[0]!.id, request.body.phoneVisibleToNeighbors,
            neighbors.left, neighbors.right, neighbors.below, neighbors.above],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const session = await getSession(pool, request.authToken!);
      if (!session) return reply.code(401).send({ error: 'unauthorized' } as never);
      return { resident: session.resident, memberships: session.memberships };
    },
  );
}
