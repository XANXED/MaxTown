import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { HouseRole, RepairMode } from '@maxtown/shared';
import { canManageServices, findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';

type HouseParams = { houseId: string };
type RepairModeBody = {
  isActive: boolean;
  title?: string;
  description?: string;
  startsAt?: string;
  expectedCompletionAt?: string;
  instructions?: string;
};
type RepairModeRow = {
  is_active: boolean; title: string | null; description: string | null;
  starts_at: Date | null; expected_completion_at: Date | null; instructions: string | null;
  updated_at: Date; updated_by_name: string | null; updated_by_role: HouseRole | null;
};
type RepairSnapshot = Omit<RepairMode, 'updatedAt' | 'updatedBy'>;

const emptySnapshot: RepairSnapshot = {
  isActive: false, title: null, description: null, startsAt: null,
  expectedCompletionAt: null, instructions: null,
};

function mapRow(row: RepairModeRow): RepairMode {
  return {
    isActive: row.is_active,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at?.toISOString() ?? null,
    expectedCompletionAt: row.expected_completion_at?.toISOString() ?? null,
    instructions: row.instructions,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by_name && row.updated_by_role ? { displayName: row.updated_by_name, role: row.updated_by_role } : null,
  };
}

function snapshot(mode: RepairMode): RepairSnapshot {
  return {
    isActive: mode.isActive, title: mode.title, description: mode.description,
    startsAt: mode.startsAt, expectedCompletionAt: mode.expectedCompletionAt, instructions: mode.instructions,
  };
}

async function readRepairMode(db: Pool | PoolClient, houseId: string): Promise<RepairMode | null> {
  const result = await db.query<RepairModeRow>(
    `SELECT rm.is_active, rm.title, rm.description, rm.starts_at, rm.expected_completion_at,
            rm.instructions, rm.updated_at, r.display_name AS updated_by_name, m.role AS updated_by_role
       FROM repair_modes rm
       LEFT JOIN memberships m ON m.id = rm.updated_by_membership_id
       LEFT JOIN residents r ON r.id = m.resident_id
      WHERE rm.house_id = $1`,
    [houseId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function inTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function registerRepairModeRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);
  const paramsSchema = { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } } as const;

  app.get<{ Params: HouseParams }>(
    '/api/houses/:houseId/repair-mode',
    { preHandler: authenticated, schema: { params: paramsSchema } },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      return { repairMode: (await readRepairMode(pool, request.params.houseId)) ?? { ...emptySnapshot, updatedAt: null, updatedBy: null } };
    },
  );

  app.put<{ Params: HouseParams; Body: RepairModeBody }>(
    '/api/houses/:houseId/repair-mode',
    {
      preHandler: authenticated,
      schema: {
        params: paramsSchema,
        body: {
          type: 'object', required: ['isActive'], additionalProperties: false,
          properties: {
            isActive: { type: 'boolean' }, title: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', minLength: 1, maxLength: 2000 },
            startsAt: { type: 'string', format: 'date-time' },
            expectedCompletionAt: { type: 'string', format: 'date-time' },
            instructions: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
      if (!access) return reply.code(403).send({ error: 'forbidden' });
      if (!canManageServices(access)) return reply.code(403).send({ error: 'repair_mode_edit_forbidden' });

      const body = request.body;
      const title = body.isActive ? body.title?.trim() : null;
      const description = body.isActive ? body.description?.trim() : null;
      const startsAt = body.isActive ? body.startsAt : undefined;
      const expectedCompletionAt = body.isActive ? body.expectedCompletionAt : undefined;
      const instructions = body.isActive ? body.instructions?.trim() || null : null;
      if (body.isActive && (!title || !description || !startsAt)) return reply.code(400).send({ error: 'repair_details_required' });
      if (startsAt && expectedCompletionAt && Date.parse(expectedCompletionAt) < Date.parse(startsAt)) {
        return reply.code(400).send({ error: 'repair_schedule_invalid' });
      }

      const result = await inTransaction(pool, async (client) => {
        // Locking House also serializes the first activation before repair_modes has a row.
        const house = await client.query('SELECT id FROM houses WHERE id = $1 FOR UPDATE', [request.params.houseId]);
        if (!house.rowCount) return { missingHouse: true as const };
        const beforeMode = await readRepairMode(client, request.params.houseId);
        const before = beforeMode ? snapshot(beforeMode) : emptySnapshot;
        const next: RepairSnapshot = {
          isActive: body.isActive,
          title: title ?? null,
          description: description ?? null,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          expectedCompletionAt: expectedCompletionAt ? new Date(expectedCompletionAt).toISOString() : null,
          instructions,
        };
        if (JSON.stringify(before) === JSON.stringify(next)) return { mode: beforeMode ?? { ...emptySnapshot, updatedAt: null, updatedBy: null }, changed: false as const };

        await client.query(
          `INSERT INTO repair_modes (house_id, is_active, title, description, starts_at, expected_completion_at, instructions, updated_by_membership_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (house_id) DO UPDATE SET is_active = EXCLUDED.is_active, title = EXCLUDED.title,
             description = EXCLUDED.description, starts_at = EXCLUDED.starts_at,
             expected_completion_at = EXCLUDED.expected_completion_at, instructions = EXCLUDED.instructions,
             updated_by_membership_id = EXCLUDED.updated_by_membership_id, updated_at = now()`,
          [request.params.houseId, next.isActive, next.title, next.description, next.startsAt, next.expectedCompletionAt, next.instructions, access.id],
        );
        const afterMode = await readRepairMode(client, request.params.houseId);
        const mode = afterMode!;
        const eventType = !before.isActive && next.isActive ? 'repair_mode.activated'
          : before.isActive && !next.isActive ? 'repair_mode.completed' : 'repair_mode.updated';
        await client.query(
          'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
          [request.params.houseId, access.id, eventType, JSON.stringify({ before, after: snapshot(mode) })],
        );
        return { mode, changed: true as const };
      });
      if ('missingHouse' in result) return reply.code(404).send({ error: 'house_not_found' });
      return { repairMode: result.mode };
    },
  );
}
