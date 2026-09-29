import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { AccidentInput, HouseEventDetails, HouseEventSummary, HouseRole, HouseStateResponse, HouseSystemState } from '@maxtown/shared';
import { HOUSE_SYSTEMS } from '@maxtown/shared/requests';
import { canManageServices, findHouseAccess, type HouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import { notifyResidents, processorIds, supporterIds } from '../notifications/in-app.ts';
import { listHouseProblems } from '../requests/store.ts';
import { linkRecentRequests } from '../requests/threshold.ts';

// События дома и Состояние дома (docs/adr/0012). Пока События — только
// Аварии: Плановые отключения и Объявления в API ещё не заведены.

type HouseParams = { houseId: string };
type EventParams = HouseParams & { eventId: string };

const uuid = { type: 'string', format: 'uuid' } as const;
const houseParams = { type: 'object', required: ['houseId'], properties: { houseId: uuid } } as const;
const eventParams = { type: 'object', required: ['houseId', 'eventId'], properties: { houseId: uuid, eventId: uuid } } as const;
/** Сколько дней закрытая Авария остаётся в списке Событий. */
const RESOLVED_VISIBLE_DAYS = 7;

const roleLabels: Record<HouseRole, string> = {
  admin: 'Администратор Дома',
  'management-company': 'УК',
  resident: 'Жилец',
};

type AccidentRow = {
  id: string; system: string; title: string; description: string; scope: string | null; advice: string[];
  opened_at: Date; expected_resolution_at: Date | null; resolved_at: Date | null;
  author_name: string | null; author_role: HouseRole | null; opened_automatically: boolean; linked_requests: number;
};

const SELECT_ACCIDENT = `
  SELECT a.id, a.system, a.title, a.description, a.scope, a.advice, a.opened_at, a.expected_resolution_at, a.resolved_at,
         author.display_name AS author_name, membership.role AS author_role,
         a.opened_by_membership_id IS NULL AS opened_automatically,
         (SELECT count(*)::int FROM requests r WHERE r.accident_id = a.id) AS linked_requests
    FROM accidents a
    LEFT JOIN memberships membership ON membership.id = a.opened_by_membership_id
    LEFT JOIN residents author ON author.id = membership.resident_id`;

function toSummary(row: AccidentRow): HouseEventSummary {
  return {
    id: row.id,
    kind: 'accident',
    title: row.title,
    startsAt: row.opened_at.toISOString(),
    ...(row.expected_resolution_at ? { endsAt: row.expected_resolution_at.toISOString() } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at.toISOString() } : {}),
  };
}

function toDetails(row: AccidentRow): HouseEventDetails {
  return {
    ...toSummary(row),
    description: row.description,
    ...(row.scope ? { scope: row.scope } : {}),
    systems: [row.system],
    advice: row.advice,
    ...(row.author_name && row.author_role ? { author: { name: row.author_name, role: roleLabels[row.author_role] } } : {}),
    ...(row.opened_automatically ? { openedAutomatically: true } : {}),
    linkedRequests: row.linked_requests,
  };
}

async function readAccident(db: Pool | PoolClient, houseId: string, eventId: string): Promise<AccidentRow | null> {
  const result = await db.query<AccidentRow>(`${SELECT_ACCIDENT} WHERE a.house_id = $1 AND a.id = $2`, [houseId, eventId]);
  return result.rows[0] ?? null;
}

/** Состояние каждой Системы: Авария важнее проблемы Дома, проблема — важнее «работает». */
async function houseState(pool: Pool, access: HouseAccess): Promise<HouseStateResponse> {
  const accidents = await pool.query<{ id: string; system: string; opened_at: Date; expected_resolution_at: Date | null }>(
    'SELECT id, system, opened_at, expected_resolution_at FROM accidents WHERE house_id = $1 AND resolved_at IS NULL',
    [access.houseId],
  );
  const problems = await listHouseProblems(pool, {
    houseId: access.houseId, residentId: access.residentId, residentName: '', processor: canManageServices(access), apartmentNumber: null,
  });
  const problemSince = await pool.query<{ id: string; category: string; created_at: Date }>(
    `SELECT DISTINCT ON (category) id, category, created_at FROM requests
      WHERE house_id = $1 AND place = 'common-property' AND status IN ('new', 'in-progress')
      ORDER BY category, created_at`,
    [access.houseId],
  );
  const systems = HOUSE_SYSTEMS.map((name): HouseSystemState => {
    const accident = accidents.rows.find((row) => row.system === name);
    if (accident) {
      return {
        name, status: 'accident', eventId: accident.id, since: accident.opened_at.toISOString(),
        ...(accident.expected_resolution_at ? { until: accident.expected_resolution_at.toISOString() } : {}),
      };
    }
    const reported = problemSince.rows.find((row) => row.category === name);
    if (reported) return { name, status: 'reported', requestId: reported.id, since: reported.created_at.toISOString() };
    return { name, status: 'working' };
  });
  return { systems, problems, updatedAt: new Date().toISOString() };
}

export function registerHouseEventRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);
  const access = (residentId: string, houseId: string) => findHouseAccess(pool, residentId, houseId);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/state', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    return { state: await houseState(pool, member) };
  });

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/events', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    const result = await pool.query<AccidentRow>(
      `${SELECT_ACCIDENT}
        WHERE a.house_id = $1 AND (a.resolved_at IS NULL OR a.resolved_at > now() - interval '${RESOLVED_VISIBLE_DAYS} days')
        ORDER BY a.resolved_at IS NOT NULL, a.opened_at DESC`,
      [member.houseId],
    );
    return { events: result.rows.map(toSummary) };
  });

  app.get<{ Params: EventParams }>('/api/houses/:houseId/events/:eventId', {
    preHandler: authenticated, schema: { params: eventParams },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    const accident = await readAccident(pool, member.houseId, request.params.eventId);
    if (!accident) return reply.code(404).send({ error: 'event_not_found' });
    return { event: toDetails(accident) };
  });

  app.post<{ Params: HouseParams; Body: AccidentInput }>('/api/houses/:houseId/events', {
    preHandler: authenticated,
    schema: {
      params: houseParams,
      body: {
        type: 'object', required: ['system', 'title', 'description'], additionalProperties: false,
        properties: {
          system: { type: 'string', enum: [...HOUSE_SYSTEMS] },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          scope: { type: 'string', maxLength: 120 },
          expectedResolutionAt: { type: 'string', format: 'date-time' },
          advice: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 300 } },
        },
      },
    },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageServices(member)) return reply.code(403).send({ error: 'accident_edit_forbidden' });
    const body = request.body;
    const title = body.title.trim();
    const description = body.description.trim();
    if (!title || !description) return reply.code(400).send({ error: 'invalid_request' });

    const opened = await inTransaction(pool, async (client) => {
      // Та же очередь, что у Заявок и Порога: строка Дома.
      await client.query('SELECT id FROM houses WHERE id = $1 FOR UPDATE', [member.houseId]);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO accidents (house_id, system, title, description, scope, advice, opened_by_membership_id, expected_resolution_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (house_id, system) WHERE resolved_at IS NULL DO NOTHING
         RETURNING id`,
        [member.houseId, body.system, title, description, body.scope?.trim() || null,
          (body.advice ?? []).map((line) => line.trim()).filter(Boolean), member.id, body.expectedResolutionAt ?? null],
      );
      const accidentId = inserted.rows[0]?.id;
      if (!accidentId) return null;
      await linkRecentRequests(client, member.houseId, body.system, accidentId, member.residentId);
      await notifyResidents(client, await processorIds(client, member.houseId), {
        kind: 'accident', houseId: member.houseId, accidentId, title: `Открыта Авария: ${title}`, body: `Система: ${body.system}`,
      }, member.residentId);
      return readAccident(client, member.houseId, accidentId);
    });
    if (!opened) {
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM accidents WHERE house_id = $1 AND system = $2 AND resolved_at IS NULL',
        [member.houseId, body.system],
      );
      return reply.code(409).send({ error: 'accident_already_open', eventId: existing.rows[0]?.id });
    }
    return reply.code(201).send({ event: toDetails(opened) });
  });

  app.post<{ Params: EventParams }>('/api/houses/:houseId/events/:eventId/resolve', {
    preHandler: authenticated, schema: { params: eventParams },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageServices(member)) return reply.code(403).send({ error: 'accident_edit_forbidden' });

    const resolved = await inTransaction(pool, async (client) => {
      const updated = await client.query<{ id: string; title: string }>(
        `UPDATE accidents SET resolved_at = now(), resolved_by_membership_id = $3
          WHERE house_id = $1 AND id = $2 AND resolved_at IS NULL
          RETURNING id, title`,
        [member.houseId, request.params.eventId, member.id],
      );
      const accident = updated.rows[0];
      if (!accident) return null;
      // Закрытая Авария закрывает все свои Заявки, которые ещё не закрыты.
      const closed = await client.query<{ id: string; number: number; author_resident_id: string }>(
        `UPDATE requests SET status = 'closed', updated_at = now()
          WHERE accident_id = $1 AND status IN ('new', 'in-progress', 'done')
          RETURNING id, number, author_resident_id`,
        [accident.id],
      );
      for (const request of closed.rows) {
        await client.query(
          "INSERT INTO request_status_changes (request_id, status, note, actor_resident_id) VALUES ($1, 'closed', 'Авария устранена', NULL)",
          [request.id],
        );
        await notifyResidents(client, [request.author_resident_id, ...await supporterIds(client, request.id)], {
          kind: 'request-status', houseId: member.houseId, requestId: request.id,
          title: `Заявка № ${request.number} закрыта`, body: `Авария «${accident.title}» устранена`,
        }, member.residentId);
      }
      return readAccident(client, member.houseId, accident.id);
    });
    if (!resolved) {
      const existing = await readAccident(pool, member.houseId, request.params.eventId);
      return existing
        ? reply.code(409).send({ error: 'accident_already_resolved' })
        : reply.code(404).send({ error: 'event_not_found' });
    }
    return { event: toDetails(resolved) };
  });
}
