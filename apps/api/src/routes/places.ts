import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { AssignedPlace, AssignedPlaceInput, HouseLocationResponse, NearestPlaceKind, NearestPlacesResponse } from '@maxtown/shared';
import { NEAREST_PLACE_KINDS } from '@maxtown/shared';
import { findHouseAccess, type HouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import type { DgisClient, GeoPoint } from '../places/dgis.ts';

// Места рядом (docs/adr/0003):
// - Закреплённые места хранятся у нас, читает любой член Дома, правит Староста;
// - Ближайшие места ищутся в 2ГИС на каждый запрос и не сохраняются.
//   Кешируется только точка Дома — это результат геокодирования, его правила
//   2ГИС разрешают хранить временно.

type HouseParams = { houseId: string };
type PlaceParams = HouseParams & { placeId: string };
type NearestParams = HouseParams & { kind: NearestPlaceKind };
type PlaceRow = {
  id: string;
  kind: AssignedPlace['kind'];
  title: string;
  address: string;
  hours: string | null;
  phone: string | null;
  note: string | null;
  lat: number | null;
  lon: number | null;
  updated_at: Date;
};

const assignedKinds = [
  'adult-clinic', 'children-clinic', 'womens-clinic', 'school', 'kindergarten',
  'polling-station', 'magistrate', 'police-precinct', 'military-office', 'other',
] as const;
const houseParamsSchema = {
  type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } },
} as const;
const placeParamsSchema = {
  type: 'object', required: ['houseId', 'placeId'],
  properties: { ...houseParamsSchema.properties, placeId: { type: 'string', format: 'uuid' } },
} as const;
const nearestParamsSchema = {
  type: 'object', required: ['houseId', 'kind'],
  properties: { ...houseParamsSchema.properties, kind: { type: 'string', enum: [...NEAREST_PLACE_KINDS] } },
} as const;
const nullableString = (maxLength: number) => ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] }) as const;
const pointSchema = {
  anyOf: [
    {
      type: 'object',
      required: ['lat', 'lon'],
      additionalProperties: false,
      properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } },
    },
    { type: 'null' },
  ],
} as const;
const placeBodySchema = {
  type: 'object',
  required: ['kind', 'title', 'address', 'hours', 'phone', 'note', 'point'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: assignedKinds },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    address: { type: 'string', minLength: 1, maxLength: 300 },
    hours: nullableString(200),
    phone: nullableString(80),
    note: nullableString(1000),
    point: pointSchema,
  },
} as const;

/** Точку Дома держим сутки; «адрес не найден» — 10 минут, чтобы не долбить 2ГИС. */
const POINT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;

function normalizeInput(input: AssignedPlaceInput): AssignedPlaceInput | null {
  const title = input.title.trim();
  const address = input.address.trim();
  const phone = input.phone?.trim() || null;
  if (!title || !address) return null;
  if (phone && !/\d/u.test(phone)) return null;
  return {
    kind: input.kind,
    title,
    address,
    hours: input.hours?.trim() || null,
    phone,
    note: input.note?.trim() || null,
    point: input.point ? { lat: input.point.lat, lon: input.point.lon } : null,
  };
}

function toPlace(row: PlaceRow): AssignedPlace {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    address: row.address,
    ...(row.hours ? { hours: row.hours } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.lat !== null && row.lon !== null ? { point: { lat: row.lat, lon: row.lon } } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}

const placeColumns = 'id, kind, title, address, hours, phone, note, lat, lon, updated_at';

async function readPlaces(db: Pool | PoolClient, houseId: string): Promise<AssignedPlace[]> {
  const result = await db.query<PlaceRow>(
    `SELECT ${placeColumns} FROM house_assigned_places
      WHERE house_id = $1 AND deleted_at IS NULL
      ORDER BY array_position($2::text[], kind), title, id`,
    [houseId, assignedKinds],
  );
  return result.rows.map(toPlace);
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
  } finally {
    client.release();
  }
}

async function writeAudit(client: PoolClient, access: HouseAccess, eventType: string, details: unknown): Promise<void> {
  await client.query(
    'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
    [access.houseId, access.id, eventType, JSON.stringify(details)],
  );
}

export function registerPlaceRoutes(app: FastifyInstance, pool: Pool, { dgis }: { dgis: DgisClient | null }): void {
  const authenticated = requireAuthentication(pool);
  const housePoints = new Map<string, { point: GeoPoint | undefined; expiresAt: number }>();

  async function requireHeadman(residentId: string, houseId: string): Promise<HouseAccess | null> {
    const access = await findHouseAccess(pool, residentId, houseId);
    return access?.role === 'headman' ? access : null;
  }

  async function housePoint(client: DgisClient, access: HouseAccess): Promise<GeoPoint | undefined> {
    // Ключ — адрес, а не id Дома: поправили адрес — ищем точку заново,
    // а не показываем старую (или старый «не найден»).
    const key = `${access.houseId}|${access.locality}|${access.address}`;
    const cached = housePoints.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.point;
    const point = await client.geocode(access.address, access.locality);
    housePoints.set(key, { point, expiresAt: Date.now() + (point ? POINT_TTL_MS : MISS_TTL_MS) });
    return point;
  }

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/places/assigned', {
    preHandler: authenticated, schema: { params: houseParamsSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    return { places: await readPlaces(pool, access.houseId) };
  });

  app.post<{ Params: HouseParams; Body: AssignedPlaceInput }>('/api/houses/:houseId/places/assigned', {
    preHandler: authenticated, schema: { params: houseParamsSchema, body: placeBodySchema },
  }, async (request, reply) => {
    const access = await requireHeadman(request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'place_edit_forbidden' });
    const input = normalizeInput(request.body);
    if (!input) return reply.code(400).send({ error: 'invalid_place' });
    const place = await inTransaction(pool, async (client) => {
      const inserted = await client.query<PlaceRow>(
        `INSERT INTO house_assigned_places (house_id, kind, title, address, hours, phone, note, lat, lon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${placeColumns}`,
        [access.houseId, input.kind, input.title, input.address, input.hours, input.phone, input.note, input.point?.lat ?? null, input.point?.lon ?? null],
      );
      const row = inserted.rows[0]!;
      await writeAudit(client, access, 'house_assigned_place.created', { placeId: row.id, after: input });
      return toPlace(row);
    });
    return reply.code(201).send({ place });
  });

  app.put<{ Params: PlaceParams; Body: AssignedPlaceInput }>('/api/houses/:houseId/places/assigned/:placeId', {
    preHandler: authenticated, schema: { params: placeParamsSchema, body: placeBodySchema },
  }, async (request, reply) => {
    const access = await requireHeadman(request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'place_edit_forbidden' });
    const input = normalizeInput(request.body);
    if (!input) return reply.code(400).send({ error: 'invalid_place' });
    const place = await inTransaction(pool, async (client) => {
      const before = await client.query<PlaceRow>(
        `SELECT ${placeColumns} FROM house_assigned_places
          WHERE id = $1 AND house_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [request.params.placeId, access.houseId],
      );
      if (!before.rowCount) return null;
      const updated = await client.query<PlaceRow>(
        `UPDATE house_assigned_places
            SET kind = $3, title = $4, address = $5, hours = $6, phone = $7, note = $8, lat = $9, lon = $10, updated_at = now()
          WHERE id = $1 AND house_id = $2 RETURNING ${placeColumns}`,
        [
          request.params.placeId, access.houseId, input.kind, input.title, input.address, input.hours, input.phone, input.note,
          input.point?.lat ?? null, input.point?.lon ?? null,
        ],
      );
      await writeAudit(client, access, 'house_assigned_place.updated', {
        placeId: request.params.placeId, before: toPlace(before.rows[0]!), after: input,
      });
      return toPlace(updated.rows[0]!);
    });
    if (!place) return reply.code(404).send({ error: 'place_not_found' });
    return { place };
  });

  app.delete<{ Params: PlaceParams }>('/api/houses/:houseId/places/assigned/:placeId', {
    preHandler: authenticated, schema: { params: placeParamsSchema },
  }, async (request, reply) => {
    const access = await requireHeadman(request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'place_edit_forbidden' });
    const deleted = await inTransaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE house_assigned_places SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND house_id = $2 AND deleted_at IS NULL`,
        [request.params.placeId, access.houseId],
      );
      if (!result.rowCount) return false;
      await writeAudit(client, access, 'house_assigned_place.deleted', { placeId: request.params.placeId });
      return true;
    });
    if (!deleted) return reply.code(404).send({ error: 'place_not_found' });
    return reply.code(204).send();
  });

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/places/location', {
    preHandler: authenticated, schema: { params: houseParamsSchema },
  }, async (request, reply): Promise<HouseLocationResponse | undefined> => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!dgis) return reply.code(503).send({ error: 'nearest_places_not_configured' });
    reply.header('Cache-Control', 'no-store');
    try {
      const point = await housePoint(dgis, access);
      if (!point) return reply.code(404).send({ error: 'house_location_unknown' });
      return { house: point };
    } catch (error) {
      request.log.warn({ err: error }, '2GIS geocoding failed');
      return reply.code(502).send({ error: 'nearest_places_unavailable' });
    }
  });

  app.get<{ Params: NearestParams }>('/api/houses/:houseId/places/nearest/:kind', {
    preHandler: authenticated, schema: { params: nearestParamsSchema },
  }, async (request, reply): Promise<NearestPlacesResponse | undefined> => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    if (!dgis) return reply.code(503).send({ error: 'nearest_places_not_configured' });
    // Правила 2ГИС запрещают хранить данные — и браузеру тоже.
    reply.header('Cache-Control', 'no-store');
    try {
      const point = await housePoint(dgis, access);
      if (!point) return reply.code(404).send({ error: 'house_location_unknown' });
      return { kind: request.params.kind, house: point, places: await dgis.nearest(request.params.kind, point) };
    } catch (error) {
      request.log.warn({ err: error }, '2GIS request failed');
      return reply.code(502).send({ error: 'nearest_places_unavailable' });
    }
  });
}
