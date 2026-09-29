import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {
  APARTMENT_REPAIR_WORK_TYPES,
  type ApartmentLayoutPosition,
  type ApartmentRepair,
  type ApartmentRepairInput,
  type ApartmentRepairWorkType,
} from '@maxtown/shared';
import { findHouseAccess, type HouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import { apartmentRepairState, normalizeWorkTypes } from '../apartment-repairs/model.ts';
import { neighboringApartmentIds, type ApartmentGridCell } from '../apartment-repairs/neighbors.ts';
import { formatHouseTime } from '../house-time.ts';

type HouseParams = { houseId: string };
type ApartmentParams = HouseParams & { apartmentId: string };
type RepairParams = HouseParams & { repairId: string };
type LayoutBody = { entrance: number; floor: number; column: number };

type LayoutRow = {
  id: string;
  number: string;
  entrance: number | null;
  floor: number | null;
  layout_column: number | null;
};

type RepairRow = {
  id: string;
  house_id: string;
  apartment_id: string;
  apartment_number: string;
  created_by_membership_id: string;
  work_types: ApartmentRepairWorkType[];
  details: string | null;
  starts_at: Date;
  ends_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type RepairEventKind = 'created' | 'updated' | 'cancelled' | 'completed';

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const apartmentParams = {
  type: 'object', required: ['houseId', 'apartmentId'], properties: { houseId: uuid, apartmentId: uuid },
} as const;
const repairParams = {
  type: 'object', required: ['houseId', 'repairId'], properties: { houseId: uuid, repairId: uuid },
} as const;
const repairBody = {
  type: 'object', required: ['workTypes', 'startsAt', 'endsAt'], additionalProperties: false,
  properties: {
    workTypes: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', enum: [...APARTMENT_REPAIR_WORK_TYPES] } },
    details: { type: 'string', minLength: 1, maxLength: 2000 },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
  },
} as const;

export class ApartmentRepairProblem extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function accessFor(pool: Pool, residentId: string, houseId: string): Promise<HouseAccess> {
  const access = await findHouseAccess(pool, residentId, houseId);
  if (!access) throw new ApartmentRepairProblem(403, 'forbidden');
  return access;
}

async function layoutRows(db: Pool | PoolClient, houseId: string, lock = false): Promise<LayoutRow[]> {
  const result = await db.query<LayoutRow>(
    `SELECT id, number, entrance, floor, layout_column
       FROM apartments WHERE house_id = $1 ORDER BY entrance NULLS LAST, floor NULLS LAST, layout_column NULLS LAST, number${lock ? ' FOR UPDATE' : ''}`,
    [houseId],
  );
  return result.rows;
}

function gridCells(rows: LayoutRow[]): ApartmentGridCell[] {
  return rows.map((row) => ({
    apartmentId: row.id,
    entrance: row.entrance,
    floor: row.floor,
    column: row.layout_column,
  }));
}

function layoutItem(row: LayoutRow, access: HouseAccess): ApartmentLayoutPosition {
  return {
    apartmentId: row.id,
    apartmentNumber: row.number,
    entrance: row.entrance,
    floor: row.floor,
    column: row.layout_column,
    canEdit: access.role === 'admin' || (access.role === 'resident' && access.apartmentId === row.id),
  };
}

function canEditRepair(row: RepairRow, access: HouseAccess): boolean {
  return access.role === 'admin' || row.created_by_membership_id === access.id;
}

function mapRepair(row: RepairRow, access: HouseAccess, now = new Date()): ApartmentRepair {
  return {
    id: row.id,
    houseId: row.house_id,
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    workTypes: row.work_types,
    details: row.details,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    state: apartmentRepairState({
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
    }, now),
    version: row.version,
    canEdit: canEditRepair(row, access),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const repairSelect = `SELECT repair.id, repair.house_id, repair.apartment_id, apartment.number AS apartment_number,
  repair.created_by_membership_id, repair.work_types, repair.details, repair.starts_at, repair.ends_at,
  repair.completed_at, repair.cancelled_at, repair.version, repair.created_at, repair.updated_at
  FROM apartment_repairs repair
  JOIN apartments apartment ON apartment.id = repair.apartment_id AND apartment.house_id = repair.house_id`;

async function readRepair(db: Pool | PoolClient, houseId: string, repairId: string, lock = false): Promise<RepairRow | null> {
  const result = await db.query<RepairRow>(
    `${repairSelect} WHERE repair.house_id = $1 AND repair.id = $2${lock ? ' FOR UPDATE OF repair' : ''}`,
    [houseId, repairId],
  );
  return result.rows[0] ?? null;
}

async function visibleApartmentIds(db: Pool | PoolClient, access: HouseAccess): Promise<Set<string>> {
  if (access.role === 'admin' || access.role === 'management-company') {
    const all = await db.query<{ id: string }>('SELECT id FROM apartments WHERE house_id = $1', [access.houseId]);
    return new Set(all.rows.map((row) => row.id));
  }
  if (!access.apartmentId) return new Set();
  const rows = await layoutRows(db, access.houseId);
  return new Set([access.apartmentId, ...neighboringApartmentIds(gridCells(rows), access.apartmentId)]);
}

async function canViewRepair(db: Pool | PoolClient, row: RepairRow, access: HouseAccess): Promise<boolean> {
  if (access.role === 'admin' || access.role === 'management-company' || row.created_by_membership_id === access.id) return true;
  return (await visibleApartmentIds(db, access)).has(row.apartment_id);
}

function validateRepairInput(input: ApartmentRepairInput, now: Date, allowExistingPastStart?: string): {
  workTypes: ApartmentRepairWorkType[]; details: string | null; startsAt: Date; endsAt: Date;
} {
  const workTypes = normalizeWorkTypes(input.workTypes);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!workTypes || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ApartmentRepairProblem(400, 'repair_details_invalid');
  }
  const unchangedPastStart = allowExistingPastStart && startsAt.toISOString() === allowExistingPastStart;
  if (!unchangedPastStart && startsAt.getTime() < now.getTime() - 5 * 60_000) {
    throw new ApartmentRepairProblem(400, 'repair_start_in_past');
  }
  if (endsAt <= now) throw new ApartmentRepairProblem(400, 'repair_end_in_past');
  const details = input.details?.trim() || null;
  return { workTypes, details, startsAt, endsAt };
}

const workLabels: Record<ApartmentRepairWorkType, string> = {
  demolition: 'демонтаж', drilling: 'сверление', flooring: 'полы', plumbing: 'сантехника',
  electrical: 'электрика', finishing: 'отделка', furniture: 'сборка мебели', other: 'другое',
};

function eventCopy(kind: RepairEventKind, row: RepairRow): { title: string; body: string; message: string } {
  const action = kind === 'created' ? 'запланирован ремонт'
    : kind === 'updated' ? 'ремонт изменён'
      : kind === 'cancelled' ? 'ремонт отменён' : 'ремонт завершён раньше';
  const title = `Квартира №${row.apartment_number}: ${action}`;
  const works = row.work_types.map((type) => workLabels[type]).join(', ');
  // Сервер в UTC: время в тексте — по поясу Дома, без секунд.
  const period = `${formatHouseTime(row.starts_at)} — ${formatHouseTime(row.ends_at)}`;
  const body = `Работы: ${works}. Период: ${period}.${row.details ? ` ${row.details}` : ''}`;
  return { title, body, message: `${title}. ${body}` };
}

async function notifyNeighbors(client: PoolClient, row: RepairRow, actorResidentId: string, kind: RepairEventKind): Promise<void> {
  const rows = await layoutRows(client, row.house_id);
  const neighbors = neighboringApartmentIds(gridCells(rows), row.apartment_id);
  if (neighbors.length === 0) return;
  const recipients = await client.query<{ resident_id: string; max_user_id: string | null }>(
    `SELECT DISTINCT membership.resident_id, resident.max_user_id
       FROM memberships membership
       JOIN residents resident ON resident.id = membership.resident_id
      WHERE membership.house_id = $1 AND membership.apartment_id = ANY($2::uuid[])
        AND membership.ended_at IS NULL AND membership.role IN ('resident', 'admin')
        AND membership.resident_id <> $3`,
    [row.house_id, neighbors, actorResidentId],
  );
  if (recipients.rows.length === 0) return;
  const copy = eventCopy(kind, row);
  const ids = recipients.rows.map((recipient) => recipient.resident_id);
  await client.query(
    `INSERT INTO in_app_notifications
       (resident_id, house_id, kind, title, body, apartment_repair_id, apartment_repair_version)
     SELECT recipient, $2, 'apartment-repair', $3, $4, $5, $6 FROM unnest($1::uuid[]) AS recipient
     ON CONFLICT (resident_id, apartment_repair_id, apartment_repair_version)
       WHERE apartment_repair_id IS NOT NULL DO NOTHING`,
    [ids, row.house_id, copy.title, copy.body, row.id, row.version],
  );
  const direct = recipients.rows.filter((recipient) => recipient.max_user_id && /^[1-9][0-9]*$/.test(recipient.max_user_id));
  if (direct.length > 0) {
    await client.query(
      `INSERT INTO max_direct_message_outbox
         (house_id, apartment_repair_id, apartment_repair_version, resident_id, max_user_id,
          event_kind, message, button_text, button_payload, dedupe_key)
       SELECT $1::uuid, $2::uuid, $3::int, recipient.resident_id, recipient.max_user_id::bigint, $4, $5,
              'Открыть ремонт', 'repair_' || $1::uuid::text || '_' || $2::uuid::text,
              'repair:' || $2::uuid::text || ':' || $3::int::text || ':' || recipient.max_user_id
         FROM unnest($6::uuid[], $7::text[]) AS recipient(resident_id, max_user_id)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [row.house_id, row.id, row.version, kind, copy.message,
        direct.map((recipient) => recipient.resident_id), direct.map((recipient) => recipient.max_user_id!)],
    );
  }
}

async function writeAudit(client: PoolClient, access: HouseAccess, eventType: string, repair: RepairRow): Promise<void> {
  await client.query(
    'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
    [access.houseId, access.id, eventType, JSON.stringify({ repairId: repair.id, apartmentId: repair.apartment_id, version: repair.version })],
  );
}

async function answerProblem(reply: FastifyReply, action: () => Promise<unknown>): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApartmentRepairProblem) return reply.code(error.status).send({ error: error.code });
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return reply.code(409).send({ error: 'layout_slot_taken' });
    }
    throw error;
  }
}

export function registerApartmentRepairRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/apartment-layout', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const rows = await layoutRows(pool, access.houseId);
    return { apartments: rows.map((row) => layoutItem(row, access)) };
  }));

  app.put<{ Params: ApartmentParams; Body: LayoutBody }>('/api/houses/:houseId/apartments/:apartmentId/layout', {
    preHandler: authenticated,
    schema: {
      params: apartmentParams,
      body: {
        type: 'object', required: ['entrance', 'floor', 'column'], additionalProperties: false,
        properties: {
          entrance: { type: 'integer', minimum: 1, maximum: 100 },
          floor: { type: 'integer', minimum: 1, maximum: 200 },
          column: { type: 'integer', minimum: -100, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const allowed = access.role === 'admin' || (access.role === 'resident' && access.apartmentId === request.params.apartmentId);
    if (!allowed) throw new ApartmentRepairProblem(403, 'layout_edit_forbidden');
    const updated = await inTransaction(pool, async (client) => {
      const rows = await layoutRows(client, access.houseId, true);
      const current = rows.find((row) => row.id === request.params.apartmentId);
      if (!current) throw new ApartmentRepairProblem(404, 'apartment_not_found');
      const conflict = rows.find((row) => row.id !== current.id && row.entrance === request.body.entrance
        && row.floor === request.body.floor && row.layout_column === request.body.column);
      if (conflict) throw new ApartmentRepairProblem(409, 'layout_slot_taken');
      const rowCells = rows.filter((row) => row.id !== current.id && row.entrance === request.body.entrance
        && row.floor === request.body.floor && row.layout_column !== null);
      if (current.layout_column === null) {
        const allowedColumns = rowCells.length === 0
          ? [0]
          : [Math.min(...rowCells.map((row) => row.layout_column!)) - 1, Math.max(...rowCells.map((row) => row.layout_column!)) + 1];
        if (!allowedColumns.includes(request.body.column)) throw new ApartmentRepairProblem(409, 'layout_column_not_at_edge');
      }

      const beforeCells = gridCells(rows);
      const afterCells = beforeCells.map((cell) => cell.apartmentId === current.id
        ? { ...cell, entrance: request.body.entrance, floor: request.body.floor, column: request.body.column }
        : cell);
      const affected = new Set([
        current.id,
        ...neighboringApartmentIds(beforeCells, current.id),
        ...neighboringApartmentIds(afterCells, current.id),
      ]);
      const open = await client.query(
        `SELECT id FROM apartment_repairs WHERE apartment_id = ANY($1::uuid[])
          AND completed_at IS NULL AND cancelled_at IS NULL AND ends_at > now() LIMIT 1`,
        [[...affected]],
      );
      if (open.rowCount) throw new ApartmentRepairProblem(409, 'layout_locked_by_repair');
      await client.query(
        `UPDATE apartments SET entrance = $3, floor = $4, layout_column = $5,
          layout_updated_by_membership_id = $6, layout_updated_at = now()
          WHERE id = $1 AND house_id = $2`,
        [current.id, access.houseId, request.body.entrance, request.body.floor, request.body.column, access.id],
      );
      await client.query(
        'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
        [access.houseId, access.id, 'apartment_layout.updated', JSON.stringify({ apartmentId: current.id, before: { entrance: current.entrance, floor: current.floor, column: current.layout_column }, after: request.body })],
      );
      return { ...current, entrance: request.body.entrance, floor: request.body.floor, layout_column: request.body.column };
    });
    return { apartment: layoutItem(updated, access) };
  }));

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/apartment-repairs', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const visible = await visibleApartmentIds(pool, access);
    // Фильтр до LIMIT: иначе сто чужих ремонтов вытеснили бы соседский.
    const result = await pool.query<RepairRow>(
      `${repairSelect} WHERE repair.house_id = $1
         AND (repair.created_by_membership_id = $2 OR repair.apartment_id = ANY($3::uuid[]))
       ORDER BY repair.starts_at DESC, repair.id DESC LIMIT 100`,
      [access.houseId, access.id, [...visible]],
    );
    return { repairs: result.rows.map((row) => mapRepair(row, access)) };
  }));

  app.get<{ Params: RepairParams }>('/api/houses/:houseId/apartment-repairs/:repairId', {
    preHandler: authenticated, schema: { params: repairParams },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const row = await readRepair(pool, access.houseId, request.params.repairId);
    if (!row || !(await canViewRepair(pool, row, access))) throw new ApartmentRepairProblem(404, 'repair_not_found');
    return { repair: mapRepair(row, access) };
  }));

  app.post<{ Params: HouseParams; Body: ApartmentRepairInput }>('/api/houses/:houseId/apartment-repairs', {
    preHandler: authenticated, schema: { params: houseParams, body: repairBody },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    // Свой ремонт объявляет тот, кто живёт в Квартире: Жилец или Администратор Дома. УК только читает.
    if (!access.apartmentId || access.role === 'management-company') throw new ApartmentRepairProblem(403, 'apartment_required');
    const now = new Date();
    const input = validateRepairInput(request.body, now);
    const row = await inTransaction(pool, async (client) => {
      const apartment = await client.query<LayoutRow>(
        'SELECT id, number, entrance, floor, layout_column FROM apartments WHERE id = $1 AND house_id = $2 FOR UPDATE',
        [access.apartmentId, access.houseId],
      );
      const target = apartment.rows[0];
      if (!target || target.entrance === null || target.floor === null || target.layout_column === null) {
        throw new ApartmentRepairProblem(409, 'apartment_layout_required');
      }
      const open = await client.query(
        `SELECT id FROM apartment_repairs WHERE apartment_id = $1
          AND completed_at IS NULL AND cancelled_at IS NULL AND ends_at > now() LIMIT 1`,
        [access.apartmentId],
      );
      if (open.rowCount) throw new ApartmentRepairProblem(409, 'apartment_repair_exists');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO apartment_repairs
          (house_id, apartment_id, created_by_membership_id, work_types, details, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [access.houseId, access.apartmentId, access.id, input.workTypes, input.details, input.startsAt, input.endsAt],
      );
      const created = (await readRepair(client, access.houseId, inserted.rows[0]!.id))!;
      await writeAudit(client, access, 'apartment_repair.created', created);
      await notifyNeighbors(client, created, access.residentId, 'created');
      return created;
    });
    return reply.code(201).send({ repair: mapRepair(row, access, now) });
  }));

  app.put<{ Params: RepairParams; Body: ApartmentRepairInput }>('/api/houses/:houseId/apartment-repairs/:repairId', {
    preHandler: authenticated, schema: { params: repairParams, body: repairBody },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const now = new Date();
    const updated = await inTransaction(pool, async (client) => {
      const current = await readRepair(client, access.houseId, request.params.repairId, true);
      if (!current) throw new ApartmentRepairProblem(404, 'repair_not_found');
      if (!canEditRepair(current, access)) throw new ApartmentRepairProblem(403, 'repair_edit_forbidden');
      const state = apartmentRepairState({ startsAt: current.starts_at, endsAt: current.ends_at, completedAt: current.completed_at, cancelledAt: current.cancelled_at }, now);
      if (state === 'completed' || state === 'cancelled') throw new ApartmentRepairProblem(409, 'repair_closed');
      const input = validateRepairInput(request.body, now, current.starts_at.toISOString());
      const sameWorkTypes = [...current.work_types].sort().join(',') === [...input.workTypes].sort().join(',');
      if (sameWorkTypes && current.details === input.details
        && current.starts_at.getTime() === input.startsAt.getTime()
        && current.ends_at.getTime() === input.endsAt.getTime()) return current;
      await client.query(
        `UPDATE apartment_repairs SET work_types = $3, details = $4, starts_at = $5, ends_at = $6,
          version = version + 1, updated_at = now() WHERE id = $1 AND house_id = $2`,
        [current.id, access.houseId, input.workTypes, input.details, input.startsAt, input.endsAt],
      );
      const row = (await readRepair(client, access.houseId, current.id))!;
      await writeAudit(client, access, 'apartment_repair.updated', row);
      await notifyNeighbors(client, row, access.residentId, 'updated');
      return row;
    });
    return { repair: mapRepair(updated, access, now) };
  }));

  app.post<{ Params: RepairParams }>('/api/houses/:houseId/apartment-repairs/:repairId/cancel', {
    preHandler: authenticated, schema: { params: repairParams },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const now = new Date();
    const row = await inTransaction(pool, async (client) => {
      const current = await readRepair(client, access.houseId, request.params.repairId, true);
      if (!current) throw new ApartmentRepairProblem(404, 'repair_not_found');
      if (!canEditRepair(current, access)) throw new ApartmentRepairProblem(403, 'repair_edit_forbidden');
      if (apartmentRepairState({ startsAt: current.starts_at, endsAt: current.ends_at, completedAt: current.completed_at, cancelledAt: current.cancelled_at }, now) !== 'scheduled') {
        throw new ApartmentRepairProblem(409, 'repair_not_scheduled');
      }
      await client.query('UPDATE apartment_repairs SET cancelled_at = $3, version = version + 1, updated_at = $3 WHERE id = $1 AND house_id = $2', [current.id, access.houseId, now]);
      const changed = (await readRepair(client, access.houseId, current.id))!;
      await writeAudit(client, access, 'apartment_repair.cancelled', changed);
      await notifyNeighbors(client, changed, access.residentId, 'cancelled');
      return changed;
    });
    return { repair: mapRepair(row, access, now) };
  }));

  app.post<{ Params: RepairParams }>('/api/houses/:houseId/apartment-repairs/:repairId/complete', {
    preHandler: authenticated, schema: { params: repairParams },
  }, async (request, reply) => answerProblem(reply, async () => {
    const access = await accessFor(pool, request.authSession!.resident.id, request.params.houseId);
    const now = new Date();
    const row = await inTransaction(pool, async (client) => {
      const current = await readRepair(client, access.houseId, request.params.repairId, true);
      if (!current) throw new ApartmentRepairProblem(404, 'repair_not_found');
      if (!canEditRepair(current, access)) throw new ApartmentRepairProblem(403, 'repair_edit_forbidden');
      if (apartmentRepairState({ startsAt: current.starts_at, endsAt: current.ends_at, completedAt: current.completed_at, cancelledAt: current.cancelled_at }, now) !== 'active') {
        throw new ApartmentRepairProblem(409, 'repair_not_active');
      }
      await client.query('UPDATE apartment_repairs SET completed_at = $3, version = version + 1, updated_at = $3 WHERE id = $1 AND house_id = $2', [current.id, access.houseId, now]);
      const changed = (await readRepair(client, access.houseId, current.id))!;
      await writeAudit(client, access, 'apartment_repair.completed', changed);
      await notifyNeighbors(client, changed, access.residentId, 'completed');
      return changed;
    });
    return { repair: mapRepair(row, access, now) };
  }));
}
