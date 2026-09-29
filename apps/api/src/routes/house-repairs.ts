import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { HouseRepair, HouseRepairHistoryEntry, HouseRepairStatus, HouseRole } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { canTransitionRepair } from './repair-lifecycle.ts';

type HouseParams = { houseId: string };
type RepairParams = HouseParams & { repairId: string };
type RepairBody = {
  title?: string;
  description?: string;
  location?: string | null;
  startsAt?: string | null;
  expectedCompletionAt?: string | null;
  contractorName?: string | null;
  contractorContact?: string | null;
  residentImpact?: string | null;
  instructions?: string | null;
  status?: HouseRepairStatus;
  note?: string;
};
type RepairRow = {
  id: string; house_id: string; title: string; description: string; location: string | null;
  status: HouseRepairStatus; starts_at: Date | null; expected_completion_at: Date | null;
  contractor_name: string | null; contractor_contact: string | null; resident_impact: string | null;
  instructions: string | null; created_at: Date; updated_at: Date;
};
type HistoryRow = {
  id: string; event_type: string; details: Record<string, unknown>; occurred_at: Date;
  display_name: string | null; role: HouseRole | null;
};

const statusValues: HouseRepairStatus[] = ['planned', 'in_progress', 'paused', 'completed', 'cancelled'];
const textProperties = {
  title: { type: 'string', minLength: 1, maxLength: 160 },
  description: { type: 'string', minLength: 1, maxLength: 2000 },
  location: { anyOf: [{ type: 'string', maxLength: 240 }, { type: 'null' }] },
  contractorName: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
  contractorContact: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
  residentImpact: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
  instructions: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
  startsAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  expectedCompletionAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  status: { type: 'string', enum: statusValues },
  note: { type: 'string', maxLength: 1000 },
} as const;

function mapRow(row: RepairRow): HouseRepair {
  return {
    id: row.id,
    houseId: row.house_id,
    title: row.title,
    description: row.description,
    location: row.location,
    status: row.status,
    startsAt: row.starts_at?.toISOString() ?? null,
    expectedCompletionAt: row.expected_completion_at?.toISOString() ?? null,
    contractorName: row.contractor_name,
    contractorContact: row.contractor_contact,
    residentImpact: row.resident_impact,
    instructions: row.instructions,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function requireText(value: string | undefined, field: string): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : field === 'title' || field === 'description' ? null : '';
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isManager(role: HouseRole): boolean {
  return role === 'headman' || role === 'responsible';
}

async function inTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const paramsSchema = {
  type: 'object', required: ['houseId'],
  properties: { houseId: { type: 'string', format: 'uuid' } },
} as const;
const repairParamsSchema = {
  type: 'object', required: ['houseId', 'repairId'],
  properties: { houseId: { type: 'string', format: 'uuid' }, repairId: { type: 'string', format: 'uuid' } },
} as const;
const bodySchema = {
  type: 'object', additionalProperties: false,
  properties: textProperties,
} as const;
const selectFields = `id, house_id, title, description, location, status, starts_at, expected_completion_at,
  contractor_name, contractor_contact, resident_impact, instructions, created_at, updated_at`;

export function registerHouseRepairRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>(
    '/api/houses/:houseId/repairs',
    { preHandler: authenticated, schema: { params: paramsSchema } },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const result = await pool.query<RepairRow>(
        `SELECT ${selectFields} FROM house_repairs WHERE house_id = $1
         ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'paused' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
                  starts_at DESC NULLS LAST, created_at DESC`,
        [request.params.houseId],
      );
      return { repairs: result.rows.map(mapRow) };
    },
  );

  app.get<{ Params: RepairParams }>(
    '/api/houses/:houseId/repairs/:repairId/history',
    { preHandler: authenticated, schema: { params: repairParamsSchema } },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      const exists = await pool.query('SELECT legacy_source_key FROM house_repairs WHERE id = $1 AND house_id = $2', [request.params.repairId, request.params.houseId]);
      if (!exists.rowCount) return reply.code(404).send({ error: 'repair_not_found' });
      const result = await pool.query<HistoryRow>(
        `SELECT event.id, event.event_type, event.details, event.occurred_at, resident.display_name, membership.role
           FROM audit_events event
           LEFT JOIN memberships membership ON membership.id = event.actor_membership_id AND membership.house_id = event.house_id
           LEFT JOIN residents resident ON resident.id = membership.resident_id
           JOIN house_repairs repair ON repair.id = $2 AND repair.house_id = event.house_id
          WHERE event.house_id = $1 AND (event.details ->> 'repairId' = $2 OR
                (repair.legacy_source_key LIKE 'repair_mode_event:%' AND event.id::text = substring(repair.legacy_source_key FROM 19)))
          ORDER BY event.occurred_at, event.id`,
        [request.params.houseId, request.params.repairId],
      );
      const history: HouseRepairHistoryEntry[] = result.rows.map((row) => ({
        id: row.id,
        repairId: request.params.repairId,
        eventType: row.event_type,
        details: row.details,
        occurredAt: row.occurred_at.toISOString(),
        actor: row.display_name && row.role ? { displayName: row.display_name, role: row.role } : null,
      }));
      return { history };
    },
  );

  app.post<{ Params: HouseParams; Body: RepairBody }>(
    '/api/houses/:houseId/repairs',
    {
      preHandler: authenticated,
      schema: {
        params: paramsSchema,
        body: { ...bodySchema, required: ['title', 'description', 'status'] },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      if (!isManager(access.role)) return reply.code(403).send({ error: 'house_repair_edit_forbidden' });
      const title = requireText(request.body.title, 'title');
      const description = requireText(request.body.description, 'description');
      if (!title || !description) return reply.code(400).send({ error: 'repair_details_required' });
      if (request.body.status !== 'planned' && request.body.status !== 'in_progress') return reply.code(400).send({ error: 'repair_status_invalid' });
      const startsAt = request.body.startsAt ?? null;
      const expectedAt = request.body.expectedCompletionAt ?? null;
      if (startsAt && expectedAt && Date.parse(expectedAt) < Date.parse(startsAt)) return reply.code(400).send({ error: 'repair_schedule_invalid' });

      const result = await inTransaction(pool, async (client) => {
        const house = await client.query('SELECT id FROM houses WHERE id = $1 FOR UPDATE', [request.params.houseId]);
        if (!house.rowCount) return null;
        const inserted = await client.query<RepairRow>(
          `INSERT INTO house_repairs (house_id, title, description, location, status, starts_at, expected_completion_at,
             contractor_name, contractor_contact, resident_impact, instructions, created_by_membership_id, updated_by_membership_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${selectFields}`,
          [request.params.houseId, title, description, normalizeOptional(request.body.location), request.body.status,
            startsAt, expectedAt, normalizeOptional(request.body.contractorName), normalizeOptional(request.body.contractorContact),
            normalizeOptional(request.body.residentImpact), normalizeOptional(request.body.instructions), access.id],
        );
        const repair = mapRow(inserted.rows[0]!);
        await client.query(
          `INSERT INTO audit_events (house_id, actor_membership_id, event_type, details)
           VALUES ($1,$2,'house_repair.created',$3::jsonb)`,
          [request.params.houseId, access.id, JSON.stringify({ repairId: repair.id, action: 'created', after: repair })],
        );
        return repair;
      });
      if (!result) return reply.code(404).send({ error: 'house_not_found' });
      return reply.code(201).send({ repair: result });
    },
  );

  app.patch<{ Params: RepairParams; Body: RepairBody }>(
    '/api/houses/:houseId/repairs/:repairId',
    {
      preHandler: authenticated,
      schema: {
        params: repairParamsSchema,
        body: { ...bodySchema, minProperties: 1 },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      if (!isManager(access.role)) return reply.code(403).send({ error: 'house_repair_edit_forbidden' });
      const result = await inTransaction(pool, async (client) => {
        const selected = await client.query<RepairRow>(
          `SELECT ${selectFields} FROM house_repairs WHERE id = $1 AND house_id = $2 FOR UPDATE`,
          [request.params.repairId, request.params.houseId],
        );
        const row = selected.rows[0];
        if (!row) return { notFound: true as const };
        const before = mapRow(row);
        const body = request.body;
        const title = body.title === undefined ? before.title : requireText(body.title, 'title');
        const description = body.description === undefined ? before.description : requireText(body.description, 'description');
        if (!title || !description) return { invalid: 'repair_details_required' as const };
        const status = body.status ?? before.status;
        if (body.status && body.status !== before.status && !canTransitionRepair(before.status, body.status, body.note)) return { invalid: 'repair_status_transition_invalid' as const };
        const startsAt = body.startsAt === undefined ? before.startsAt : body.startsAt;
        const expectedAt = body.expectedCompletionAt === undefined ? before.expectedCompletionAt : body.expectedCompletionAt;
        if (startsAt && expectedAt && Date.parse(expectedAt) < Date.parse(startsAt)) return { invalid: 'repair_schedule_invalid' as const };
        const next = {
          ...before,
          title,
          description,
          location: body.location === undefined ? before.location : normalizeOptional(body.location),
          status,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          expectedCompletionAt: expectedAt ? new Date(expectedAt).toISOString() : null,
          contractorName: body.contractorName === undefined ? before.contractorName : normalizeOptional(body.contractorName),
          contractorContact: body.contractorContact === undefined ? before.contractorContact : normalizeOptional(body.contractorContact),
          residentImpact: body.residentImpact === undefined ? before.residentImpact : normalizeOptional(body.residentImpact),
          instructions: body.instructions === undefined ? before.instructions : normalizeOptional(body.instructions),
        };
        const { id, houseId, createdAt } = before;
        if (JSON.stringify({ ...before, updatedAt: '' }) === JSON.stringify({ ...next, updatedAt: '' })) return { repair: before, unchanged: true as const };
        const updated = await client.query<RepairRow>(
          `UPDATE house_repairs SET title=$3, description=$4, location=$5, status=$6, starts_at=$7,
             expected_completion_at=$8, contractor_name=$9, contractor_contact=$10, resident_impact=$11,
             instructions=$12, updated_by_membership_id=$13, updated_at=now()
           WHERE id=$1 AND house_id=$2 RETURNING ${selectFields}`,
          [id, houseId, next.title, next.description, next.location, next.status, next.startsAt,
            next.expectedCompletionAt, next.contractorName, next.contractorContact, next.residentImpact,
            next.instructions, access.id],
        );
        const repair = mapRow(updated.rows[0]!);
        const eventType = body.status && body.status !== before.status ? 'house_repair.status_changed' : 'house_repair.updated';
        await client.query(
          `INSERT INTO audit_events (house_id, actor_membership_id, event_type, details)
           VALUES ($1,$2,$3,$4::jsonb)`,
          [houseId, access.id, eventType, JSON.stringify({ repairId: id, action: eventType.slice('house_repair.'.length), before, after: repair, note: body.note?.trim() || null })],
        );
        return { repair, unchanged: false as const, createdAt };
      });
      if ('notFound' in result) return reply.code(404).send({ error: 'repair_not_found' });
      if ('invalid' in result) return reply.code(400).send({ error: result.invalid });
      return { repair: result.repair };
    },
  );
}
