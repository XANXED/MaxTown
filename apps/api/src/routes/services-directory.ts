import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { HouseService, HouseServiceTariff } from '@maxtown/shared';
import { canManageServices, findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';

type HouseParams = { houseId: string };
type ServiceParams = HouseParams & { serviceId: string };
type TariffInput = Omit<HouseServiceTariff, 'id'> & { amount: string };
type ServiceInput = Omit<HouseService, 'id' | 'tariffs' | 'updatedAt'> & { tariffs: TariffInput[] };
type ServiceRow = { id: string; house_id: string; category: HouseService['category']; provider: string; title: string; state: HouseService['state']; contacts: HouseService['contacts']; note: string | null; updated_at: Date };
type TariffRow = { id: string; service_id: string; amount: string; currency: string; billing_period: string; conditions: string; starts_on: string; ends_on: string | null; source: string; checked_on: string };

const paramsSchema = { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } } as const;
const tariffSchema = {
  type: 'object', required: ['amount', 'currency', 'billingPeriod', 'conditions', 'startsOn', 'endsOn', 'source', 'checkedOn'], additionalProperties: false,
  properties: {
    amount: { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,2})?$' }, currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    billingPeriod: { type: 'string', minLength: 1, maxLength: 80 }, conditions: { type: 'string', maxLength: 2000 },
    startsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, endsOn: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
    source: { type: 'string', minLength: 1, maxLength: 1000 }, checkedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;
const serviceSchema = {
  type: 'object', required: ['category', 'provider', 'title', 'state', 'contacts', 'note', 'tariffs'], additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['internet', 'telecom', 'utilities', 'maintenance', 'other'] },
    provider: { type: 'string', minLength: 1, maxLength: 160 }, title: { type: 'string', minLength: 1, maxLength: 160 },
    state: { type: 'string', enum: ['available', 'limited', 'unavailable', 'discontinued'] },
    contacts: { type: 'object', additionalProperties: false, properties: { phone: { type: 'string', maxLength: 80 }, link: { type: 'string', maxLength: 500 }, details: { type: 'string', maxLength: 1000 } } },
    note: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] }, tariffs: { type: 'array', maxItems: 30, items: tariffSchema },
  },
} as const;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validInput(input: ServiceInput): boolean {
  return input.provider.trim().length > 0 && input.title.trim().length > 0 && input.tariffs.every((tariff) =>
    tariff.source.trim().length > 0 && tariff.billingPeriod.trim().length > 0 && validDate(tariff.startsOn) && validDate(tariff.checkedOn)
    && (tariff.endsOn === null || (validDate(tariff.endsOn) && tariff.endsOn >= tariff.startsOn)),
  );
}

async function readServices(db: Pool | PoolClient, houseId: string): Promise<HouseService[]> {
  const services = await db.query<ServiceRow>('SELECT id, house_id, category, provider, title, state, contacts, note, updated_at FROM house_services WHERE house_id = $1 ORDER BY category, provider, title', [houseId]);
  if (!services.rowCount) return [];
  const tariffs = await db.query<TariffRow>(
    `SELECT id, service_id, amount::text, currency, billing_period, conditions, starts_on::text, ends_on::text, source, checked_on::text
       FROM house_service_tariffs WHERE house_id = $1 ORDER BY starts_on DESC, id`, [houseId],
  );
  return services.rows.map((row) => ({
    id: row.id, category: row.category, provider: row.provider, title: row.title, state: row.state, contacts: row.contacts,
    note: row.note, updatedAt: row.updated_at.toISOString(),
    tariffs: tariffs.rows.filter((tariff) => tariff.service_id === row.id).map((tariff) => ({
      id: tariff.id, amount: tariff.amount, currency: tariff.currency, billingPeriod: tariff.billing_period,
      conditions: tariff.conditions, startsOn: tariff.starts_on, endsOn: tariff.ends_on, source: tariff.source, checkedOn: tariff.checked_on,
    })),
  }));
}

async function inTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function saveService(client: PoolClient, houseId: string, input: ServiceInput, serviceId?: string): Promise<string | null> {
  let id: string;
  if (serviceId) {
    const updated = await client.query<{ id: string }>(
      `UPDATE house_services SET category=$3, provider=$4, title=$5, state=$6, contacts=$7, note=$8, updated_at=now()
        WHERE id=$1 AND house_id=$2 RETURNING id`,
      [serviceId, houseId, input.category, input.provider.trim(), input.title.trim(), input.state, input.contacts, input.note?.trim() || null],
    );
    if (!updated.rowCount) return null;
    id = updated.rows[0]!.id;
    await client.query('DELETE FROM house_service_tariffs WHERE service_id = $1', [id]);
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO house_services (house_id, category, provider, title, state, contacts, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [houseId, input.category, input.provider.trim(), input.title.trim(), input.state, input.contacts, input.note?.trim() || null],
    );
    id = inserted.rows[0]!.id;
  }
  for (const tariff of input.tariffs) {
    await client.query(
      `INSERT INTO house_service_tariffs (service_id, house_id, amount, currency, billing_period, conditions, starts_on, ends_on, source, checked_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, houseId, tariff.amount, tariff.currency, tariff.billingPeriod.trim(), tariff.conditions.trim(), tariff.startsOn, tariff.endsOn, tariff.source.trim(), tariff.checkedOn],
    );
  }
  return id;
}

export function registerServicesDirectoryRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);
  app.get<{ Params: HouseParams }>('/api/houses/:houseId/services', { preHandler: authenticated, schema: { params: paramsSchema } }, async (request, reply) => {
    if (!await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId)) return reply.code(403).send({ error: 'forbidden' });
    return { services: await readServices(pool, request.params.houseId) };
  });

  app.post<{ Params: HouseParams; Body: ServiceInput }>('/api/houses/:houseId/services', {
    preHandler: authenticated, schema: { params: paramsSchema, body: serviceSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageServices(access)) return reply.code(403).send({ error: 'service_edit_forbidden' });
    if (!validInput(request.body)) return reply.code(400).send({ error: 'invalid_service_or_tariff' });
    const id = await inTransaction(pool, (client) => saveService(client, request.params.houseId, request.body));
    const service = (await readServices(pool, request.params.houseId)).find((item) => item.id === id)!;
    return reply.code(201).send({ service });
  });

  app.put<{ Params: ServiceParams; Body: ServiceInput }>('/api/houses/:houseId/services/:serviceId', {
    preHandler: authenticated, schema: { params: { type: 'object', required: ['houseId', 'serviceId'], properties: { ...paramsSchema.properties, serviceId: { type: 'string', format: 'uuid' } } }, body: serviceSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageServices(access)) return reply.code(403).send({ error: 'service_edit_forbidden' });
    if (!validInput(request.body)) return reply.code(400).send({ error: 'invalid_service_or_tariff' });
    const id = await inTransaction(pool, (client) => saveService(client, request.params.houseId, request.body, request.params.serviceId));
    if (!id) return reply.code(404).send({ error: 'service_not_found' });
    const service = (await readServices(pool, request.params.houseId)).find((item) => item.id === id)!;
    return { service };
  });
}
