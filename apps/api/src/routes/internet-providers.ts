import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type {
  HouseInternetProvider,
  HouseInternetProviderInput,
  HouseInternetProviderRating,
  HouseInternetProviderImportState,
  InternetTariff,
} from '@maxtown/shared';
import { canManageHouse, findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';

type HouseParams = { houseId: string };
type ProviderParams = HouseParams & { providerId: string };
type ProviderRow = {
  id: string;
  provider: string;
  state: HouseInternetProvider['availability'];
  contacts: { phone?: string; link?: string };
  note: string | null;
  updated_at: Date;
  source: HouseInternetProvider['source'];
  source_external_id: string | null;
  source_checked_at: Date | null;
  manual_override: boolean;
  rating_average: string | null;
  rating_count: number;
  my_score: number | null;
};
type TariffRow = {
  id: string;
  service_id: string;
  tariff_name: string;
  speed_mbps: number | null;
  amount: string;
  promo_amount: string | null;
  promo_months: number | null;
  technology: InternetTariff['technology'];
  has_tv: boolean;
  conditions: string;
  source: string;
  checked_on: string;
};

type SyncRow = {
  source: Exclude<HouseInternetProvider['source'], 'manual'>;
  status: HouseInternetProviderImportState['status'];
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  error: string | null;
};

const houseParamsSchema = {
  type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } },
} as const;
const providerParamsSchema = {
  type: 'object', required: ['houseId', 'providerId'], properties: {
    houseId: { type: 'string', format: 'uuid' }, providerId: { type: 'string', format: 'uuid' },
  },
} as const;
const moneyPattern = '^\\d{1,10}(\\.\\d{1,2})?$';
const datePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const nullableString = (maxLength: number) => ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] }) as const;
const nullableMoney = { anyOf: [{ type: 'string', pattern: moneyPattern }, { type: 'null' }] } as const;
// type-union не даёт AJV превратить 0 в null при проверке любой ветки anyOf.
const nullablePositiveInteger = { type: ['integer', 'null'], minimum: 1 } as const;
const providerBodySchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'availability', 'phone', 'link', 'note', 'tariffs'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 },
    availability: { type: 'string', enum: ['available', 'limited'] },
    phone: nullableString(80),
    link: nullableString(500),
    note: nullableString(2000),
    tariffs: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'speedMbps', 'monthlyPrice', 'promoPrice', 'promoMonths', 'technology', 'hasTv', 'conditions', 'source', 'checkedOn'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 160 },
          speedMbps: nullablePositiveInteger,
          monthlyPrice: { type: 'string', pattern: moneyPattern },
          promoPrice: nullableMoney,
          promoMonths: nullablePositiveInteger,
          technology: { anyOf: [{ type: 'string', enum: ['fttb', 'gpon', 'docsis', 'xdsl', 'wireless', 'other'] }, { type: 'null' }] },
          hasTv: { type: 'boolean' },
          conditions: { type: 'string', maxLength: 2000 },
          source: { type: 'string', minLength: 1, maxLength: 1000 },
          checkedOn: { type: 'string', pattern: datePattern },
        },
      },
    },
  },
} as const;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validHttps(value: string | null): boolean {
  if (value === null || value.trim() === '') return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function validProvider(input: HouseInternetProviderInput): boolean {
  if (!input.name.trim() || !validHttps(input.link)) return false;
  return input.tariffs.every((tariff) => {
    const regular = Number(tariff.monthlyPrice);
    const promo = tariff.promoPrice === null ? null : Number(tariff.promoPrice);
    return tariff.name.trim().length > 0
      && tariff.source.trim().length > 0
      && validDate(tariff.checkedOn)
      && Number.isFinite(regular)
      && regular >= 0
      && (promo === null || (Number.isFinite(promo) && promo >= 0 && promo <= regular))
      && ((tariff.promoPrice === null && tariff.promoMonths === null) || (tariff.promoPrice !== null && tariff.promoMonths !== null));
  });
}

async function readProviders(db: Pool | PoolClient, houseId: string, membershipId: string): Promise<HouseInternetProvider[]> {
  const [providers, tariffs] = await Promise.all([
    db.query<ProviderRow>(
      `SELECT service.id, service.provider, service.state, service.contacts, service.note, service.updated_at,
              service.source, service.source_external_id, service.source_checked_at, service.manual_override,
              round(avg(rating.score)::numeric, 1)::text AS rating_average,
              count(rating.score)::int AS rating_count,
              max(rating.score) FILTER (WHERE rating.membership_id = $2)::int AS my_score
         FROM house_services service
         LEFT JOIN house_internet_provider_ratings rating
           ON rating.service_id = service.id AND rating.house_id = service.house_id
          AND EXISTS (SELECT 1 FROM memberships active_member
                       WHERE active_member.id = rating.membership_id AND active_member.house_id = rating.house_id
                         AND active_member.ended_at IS NULL)
        WHERE service.house_id = $1 AND service.category = 'internet' AND service.state IN ('available', 'limited')
        GROUP BY service.id
        ORDER BY avg(rating.score) DESC NULLS LAST, count(rating.score) DESC, service.provider`,
      [houseId, membershipId],
    ),
    db.query<TariffRow>(
      `SELECT tariff.id, tariff.service_id, tariff.tariff_name, tariff.speed_mbps,
              tariff.amount::text, tariff.promo_amount::text, tariff.promo_months,
              tariff.technology, tariff.has_tv, tariff.conditions, tariff.source, tariff.checked_on::text
         FROM house_service_tariffs tariff
         JOIN house_services service ON service.id = tariff.service_id AND service.house_id = tariff.house_id
        WHERE tariff.house_id = $1 AND service.category = 'internet'
          AND (tariff.ends_on IS NULL OR tariff.ends_on >= current_date)
        ORDER BY tariff.promo_amount NULLS LAST, tariff.amount, tariff.tariff_name`,
      [houseId],
    ),
  ]);
  return providers.rows.map((provider) => ({
    id: provider.id,
    name: provider.provider,
    availability: provider.state,
    phone: provider.contacts.phone?.trim() || null,
    link: provider.contacts.link?.trim() || null,
    note: provider.note,
    updatedAt: provider.updated_at.toISOString(),
    source: provider.source,
    sourceExternalId: provider.source_external_id,
    sourceCheckedAt: provider.source_checked_at?.toISOString() ?? null,
    manualOverride: provider.manual_override,
    tariffs: tariffs.rows.filter((tariff) => tariff.service_id === provider.id).map((tariff) => ({
      id: tariff.id,
      name: tariff.tariff_name,
      speedMbps: tariff.speed_mbps,
      monthlyPrice: tariff.amount,
      promoPrice: tariff.promo_amount,
      promoMonths: tariff.promo_months,
      technology: tariff.technology,
      hasTv: tariff.has_tv,
      conditions: tariff.conditions,
      source: tariff.source,
      checkedOn: tariff.checked_on,
    })),
    rating: {
      average: provider.rating_average === null ? null : Number(provider.rating_average),
      count: provider.rating_count,
      myScore: provider.my_score,
    },
  }));
}

async function readImportState(db: Pool | PoolClient, houseId: string): Promise<HouseInternetProviderImportState> {
  const result = await db.query<SyncRow>(
    `SELECT source, status, last_attempt_at, last_success_at, error
       FROM house_internet_provider_syncs
      WHERE house_id = $1`,
    [houseId],
  );
  const row = result.rows[0];
  if (!row) return { status: 'not-configured', source: null, lastAttemptAt: null, lastSuccessAt: null, error: null };
  return {
    status: row.status,
    source: row.source,
    lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    error: row.error,
  };
}

async function inTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function saveProvider(
  client: PoolClient,
  houseId: string,
  actorMembershipId: string,
  input: HouseInternetProviderInput,
  providerId?: string,
): Promise<string | null> {
  const contacts = { ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), ...(input.link?.trim() ? { link: input.link.trim() } : {}) };
  let id: string;
  let eventType = 'internet_provider.created';
  if (providerId) {
    const updated = await client.query<{ id: string }>(
      `UPDATE house_services
          SET provider = $3, title = 'Домашний интернет', state = $4, contacts = $5, note = $6,
              manual_override = true, updated_at = now()
        WHERE id = $1 AND house_id = $2 AND category = 'internet' RETURNING id`,
      [providerId, houseId, input.name.trim(), input.availability, contacts, input.note?.trim() || null],
    );
    if (!updated.rowCount) return null;
    id = updated.rows[0]!.id;
    eventType = 'internet_provider.updated';
    await client.query('DELETE FROM house_service_tariffs WHERE service_id = $1', [id]);
  } else {
    const duplicate = await client.query<{ id: string; state: string }>(
      "SELECT id, state FROM house_services WHERE house_id = $1 AND category = 'internet' AND lower(btrim(provider)) = lower(btrim($2)) LIMIT 1",
      [houseId, input.name],
    );
    const previous = duplicate.rows[0];
    if (previous && previous.state !== 'discontinued') return 'duplicate';
    if (previous) {
      id = previous.id;
      eventType = 'internet_provider.restored';
      await client.query(
          `UPDATE house_services
              SET provider = $3, title = 'Домашний интернет', state = $4, contacts = $5, note = $6,
                  source = 'manual', source_external_id = NULL, source_checked_at = now(), manual_override = true,
                  updated_at = now()
          WHERE id = $1 AND house_id = $2`,
        [id, houseId, input.name.trim(), input.availability, contacts, input.note?.trim() || null],
      );
      await client.query('DELETE FROM house_service_tariffs WHERE service_id = $1', [id]);
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO house_services (house_id, category, provider, title, state, contacts, note)
         VALUES ($1, 'internet', $2, 'Домашний интернет', $3, $4, $5) RETURNING id`,
        [houseId, input.name.trim(), input.availability, contacts, input.note?.trim() || null],
      );
      id = inserted.rows[0]!.id;
    }
  }
  for (const tariff of input.tariffs) {
    await client.query(
      `INSERT INTO house_service_tariffs
         (service_id, house_id, amount, currency, billing_period, conditions, starts_on, ends_on, source, checked_on,
          tariff_name, speed_mbps, promo_amount, promo_months, technology, has_tv)
       VALUES ($1, $2, $3, 'RUB', 'месяц', $4, $5, NULL, $6, $5, $7, $8, $9, $10, $11, $12)`,
      [id, houseId, tariff.monthlyPrice, tariff.conditions.trim(), tariff.checkedOn, tariff.source.trim(), tariff.name.trim(),
        tariff.speedMbps, tariff.promoPrice, tariff.promoMonths, tariff.technology, tariff.hasTv],
    );
  }
  await client.query(
    'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
    [houseId, actorMembershipId, eventType, JSON.stringify({ providerId: id, provider: input.name.trim() })],
  );
  return id;
}

export function registerInternetProviderRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/internet-providers', {
    preHandler: authenticated, schema: { params: houseParamsSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    return {
      providers: await readProviders(pool, request.params.houseId, access.id),
      importState: await readImportState(pool, request.params.houseId),
    };
  });

  app.post<{ Params: HouseParams; Body: HouseInternetProviderInput }>('/api/houses/:houseId/internet-providers', {
    preHandler: authenticated, schema: { params: houseParamsSchema, body: providerBodySchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageHouse(access)) return reply.code(403).send({ error: 'internet_provider_edit_forbidden' });
    if (!validProvider(request.body)) return reply.code(400).send({ error: 'invalid_internet_provider' });
    const id = await inTransaction(pool, (client) => saveProvider(client, request.params.houseId, access.id, request.body));
    if (id === 'duplicate') return reply.code(409).send({ error: 'internet_provider_already_exists' });
    const provider = (await readProviders(pool, request.params.houseId, access.id)).find((item) => item.id === id)!;
    return reply.code(201).send({ provider });
  });

  app.put<{ Params: ProviderParams; Body: HouseInternetProviderInput }>('/api/houses/:houseId/internet-providers/:providerId', {
    preHandler: authenticated, schema: { params: providerParamsSchema, body: providerBodySchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageHouse(access)) return reply.code(403).send({ error: 'internet_provider_edit_forbidden' });
    if (!validProvider(request.body)) return reply.code(400).send({ error: 'invalid_internet_provider' });
    const id = await inTransaction(pool, (client) => saveProvider(client, request.params.houseId, access.id, request.body, request.params.providerId));
    if (!id) return reply.code(404).send({ error: 'internet_provider_not_found' });
    const provider = (await readProviders(pool, request.params.houseId, access.id)).find((item) => item.id === id)!;
    return { provider };
  });

  app.delete<{ Params: ProviderParams }>('/api/houses/:houseId/internet-providers/:providerId', {
    preHandler: authenticated, schema: { params: providerParamsSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageHouse(access)) return reply.code(403).send({ error: 'internet_provider_edit_forbidden' });
    const removed = await inTransaction(pool, async (client) => {
      const result = await client.query(
        "UPDATE house_services SET state = 'discontinued', manual_override = true, updated_at = now() WHERE id = $1 AND house_id = $2 AND category = 'internet' AND state <> 'discontinued' RETURNING provider",
        [request.params.providerId, request.params.houseId],
      );
      if (!result.rowCount) return false;
      await client.query(
        'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
        [request.params.houseId, access.id, 'internet_provider.removed', JSON.stringify({ providerId: request.params.providerId })],
      );
      return true;
    });
    if (!removed) return reply.code(404).send({ error: 'internet_provider_not_found' });
    return reply.code(204).send();
  });

  app.put<{ Params: ProviderParams; Body: { score: number } }>('/api/houses/:houseId/internet-providers/:providerId/rating', {
    preHandler: authenticated,
    schema: { params: providerParamsSchema, body: { type: 'object', additionalProperties: false, required: ['score'], properties: { score: { type: 'integer', minimum: 1, maximum: 5 } } } },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    // Оценивают те, кто живёт в Доме: Жилец и Администратор Дома, но не УК.
    if (access.role === 'management-company') return reply.code(403).send({ error: 'resident_membership_required' });
    const provider = await pool.query(
      "SELECT 1 FROM house_services WHERE id = $1 AND house_id = $2 AND category = 'internet' AND state IN ('available', 'limited')",
      [request.params.providerId, request.params.houseId],
    );
    if (!provider.rowCount) return reply.code(404).send({ error: 'internet_provider_not_found' });
    await pool.query(
      `INSERT INTO house_internet_provider_ratings (service_id, house_id, membership_id, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (service_id, membership_id) DO UPDATE SET score = EXCLUDED.score, updated_at = now()`,
      [request.params.providerId, request.params.houseId, access.id, request.body.score],
    );
    const current = (await readProviders(pool, request.params.houseId, access.id)).find((item) => item.id === request.params.providerId);
    const rating: HouseInternetProviderRating | undefined = current?.rating;
    return { rating };
  });
}
