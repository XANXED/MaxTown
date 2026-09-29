import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type {
  AccidentEmergency,
  AccidentInput,
  AccidentUpdate,
  AccidentWorkStatus,
  HouseEmergency,
  HouseEventDetails,
  HouseEventSummary,
  HouseRole,
  HouseStateResponse,
  HouseSystemState,
} from '@maxtown/shared';
import { HOUSE_SYSTEMS } from '@maxtown/shared/requests';
import { canManageServices, findHouseAccess, type HouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';
import { notifyResidents, processorIds, supporterIds } from '../notifications/in-app.ts';
import { listHouseProblems } from '../requests/store.ts';
import { linkRecentRequests } from '../requests/threshold.ts';

// События дома и Состояние дома (docs/adr/0012). Пока События — только
// Аварии: Плановые отключения и Объявления в API ещё не заведены. Открытая
// Авария — режим ЧС: статус работ, срок и «У меня тоже».

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
  id: string; house_id: string; system: string; title: string; description: string; scope: string | null; advice: string[];
  opened_at: Date; expected_resolution_at: Date | null; resolved_at: Date | null;
  work_status: AccidentWorkStatus; deadline_revised: boolean;
  author_name: string | null; author_role: HouseRole | null; opened_automatically: boolean; linked_requests: number;
};

const SELECT_ACCIDENT = `
  SELECT a.id, a.house_id, a.system, a.title, a.description, a.scope, a.advice, a.opened_at, a.expected_resolution_at,
         a.resolved_at, a.work_status, a.deadline_revised,
         author.display_name AS author_name, membership.role AS author_role,
         a.opened_by_membership_id IS NULL AS opened_automatically,
         (SELECT count(*)::int FROM requests r WHERE r.accident_id = a.id) AS linked_requests
    FROM accidents a
    LEFT JOIN memberships membership ON membership.id = a.opened_by_membership_id
    LEFT JOIN residents author ON author.id = membership.resident_id`;

/**
 * Кто сообщил о проблеме Аварии: отметил «У меня тоже» на ней, подал
 * привязанную Заявку или отметил «У меня тоже» на такой Заявке. Отменённая,
 * отклонённая или закрытая Заявка больше не подтверждает проблему.
 * $1 — Авария.
 */
const AFFECTED_RESIDENTS = `
  SELECT c.resident_id, NULL::text AS apartment FROM accident_confirmations c WHERE c.accident_id = $1
  UNION ALL
  SELECT r.author_resident_id, r.apartment_number FROM requests r
   WHERE r.accident_id = $1 AND r.status IN ('new', 'in-progress', 'done')
  UNION ALL
  SELECT s.resident_id, NULL::text FROM request_supporters s JOIN requests r ON r.id = s.request_id
   WHERE r.accident_id = $1 AND r.status IN ('new', 'in-progress', 'done')`;

/**
 * Режим ЧС для того, кто смотрит. Квартиры считаются по членству в Доме,
 * иначе по Квартире из Заявки; если Квартира неизвестна, человек считается
 * отдельной квартирой. Два Жильца одной квартиры — одна квартира.
 */
async function emergencyFor(db: Pool | PoolClient, accident: AccidentRow, residentId: string): Promise<AccidentEmergency> {
  const result = await db.query<{ confirmed_apartments: number; affected_me: boolean; confirmed_directly: boolean }>(
    `WITH affected AS (${AFFECTED_RESIDENTS}),
     keyed AS (
       SELECT affected.resident_id,
              coalesce(upper(apartment.number), upper(affected.apartment), 'resident:' || affected.resident_id::text) AS apartment_key
         FROM affected
         LEFT JOIN memberships membership
           ON membership.resident_id = affected.resident_id AND membership.house_id = $2 AND membership.ended_at IS NULL
         LEFT JOIN apartments apartment ON apartment.id = membership.apartment_id AND apartment.house_id = membership.house_id
     )
     SELECT count(DISTINCT apartment_key)::int AS confirmed_apartments,
            coalesce(bool_or(resident_id = $3), false) AS affected_me,
            EXISTS (SELECT 1 FROM accident_confirmations c WHERE c.accident_id = $1 AND c.resident_id = $3) AS confirmed_directly
       FROM keyed`,
    [accident.id, accident.house_id, residentId],
  );
  const row = result.rows[0]!;
  const open = accident.resolved_at === null;
  return {
    workStatus: accident.work_status,
    confirmedApartments: row.confirmed_apartments,
    deadlineRevised: accident.deadline_revised,
    confirmedByMe: row.affected_me,
    canConfirm: open && !row.affected_me,
    canWithdraw: open && row.confirmed_directly,
  };
}

/** Все, кто сообщил о проблеме Аварии, — им Уведомления о ходе работ. */
async function affectedResidentIds(db: Pool | PoolClient, accidentId: string): Promise<string[]> {
  const result = await db.query<{ resident_id: string }>(
    `SELECT DISTINCT resident_id FROM (${AFFECTED_RESIDENTS}) affected`,
    [accidentId],
  );
  return result.rows.map((row) => row.resident_id);
}

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

function toDetails(row: AccidentRow, emergency: AccidentEmergency): HouseEventDetails {
  return {
    ...toSummary(row),
    description: row.description,
    ...(row.scope ? { scope: row.scope } : {}),
    systems: [row.system],
    advice: row.advice,
    ...(row.author_name && row.author_role ? { author: { name: row.author_name, role: roleLabels[row.author_role] } } : {}),
    ...(row.opened_automatically ? { openedAutomatically: true } : {}),
    linkedRequests: row.linked_requests,
    emergency,
  };
}

async function readAccident(db: Pool | PoolClient, houseId: string, eventId: string, lock = false): Promise<AccidentRow | null> {
  const result = await db.query<AccidentRow>(
    `${SELECT_ACCIDENT} WHERE a.house_id = $1 AND a.id = $2 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [houseId, eventId],
  );
  return result.rows[0] ?? null;
}

async function detailsFor(db: Pool | PoolClient, row: AccidentRow, residentId: string): Promise<HouseEventDetails> {
  return toDetails(row, await emergencyFor(db, row, residentId));
}

/** Состояние каждой Системы: Авария важнее проблемы Дома, проблема — важнее «работает». */
async function houseState(pool: Pool, access: HouseAccess): Promise<HouseStateResponse> {
  const accidents = await pool.query<AccidentRow>(
    `${SELECT_ACCIDENT} WHERE a.house_id = $1 AND a.resolved_at IS NULL ORDER BY a.opened_at DESC`,
    [access.houseId],
  );
  const emergencies = await Promise.all(accidents.rows.map(async (accident): Promise<HouseEmergency> => ({
    ...await emergencyFor(pool, accident, access.residentId),
    id: accident.id,
    title: accident.title,
    system: accident.system,
    openedAt: accident.opened_at.toISOString(),
    ...(accident.expected_resolution_at ? { expectedResolutionAt: accident.expected_resolution_at.toISOString() } : {}),
  })));
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
  return { systems, emergencies, problems, updatedAt: new Date().toISOString() };
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
    return { event: await detailsFor(pool, accident, member.residentId) };
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
      const accident = await readAccident(client, member.houseId, accidentId);
      return accident ? detailsFor(client, accident, member.residentId) : null;
    });
    if (!opened) {
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM accidents WHERE house_id = $1 AND system = $2 AND resolved_at IS NULL',
        [member.houseId, body.system],
      );
      return reply.code(409).send({ error: 'accident_already_open', eventId: existing.rows[0]?.id });
    }
    return reply.code(201).send({ event: opened });
  });

  // УК и Администратор Дома ведут открытую Аварию: заголовок, статус работ, срок.
  app.patch<{ Params: EventParams; Body: AccidentUpdate }>('/api/houses/:houseId/events/:eventId', {
    preHandler: authenticated,
    schema: {
      params: eventParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          workStatus: { type: 'string', enum: ['checking', 'repairing'] },
          expectedResolutionAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
        },
      },
    },
  }, async (request, reply) => {
    const member = await access(request.authSession!.resident.id, request.params.houseId);
    if (!member) return reply.code(403).send({ error: 'forbidden' });
    if (!canManageServices(member)) return reply.code(403).send({ error: 'accident_edit_forbidden' });
    const body = request.body;
    const title = body.title?.trim();
    if (body.title !== undefined && !title) return reply.code(400).send({ error: 'invalid_request' });

    const updated = await inTransaction(pool, async (client) => {
      const before = await readAccident(client, member.houseId, request.params.eventId, true);
      if (!before) return { error: 404 as const };
      if (before.resolved_at) return { error: 409 as const };
      const deadline = body.expectedResolutionAt === undefined
        ? before.expected_resolution_at
        : body.expectedResolutionAt === null ? null : new Date(body.expectedResolutionAt);
      const deadlineChanged = (deadline?.getTime() ?? null) !== (before.expected_resolution_at?.getTime() ?? null);
      const statusChanged = body.workStatus !== undefined && body.workStatus !== before.work_status;
      await client.query(
        `UPDATE accidents
            SET title = $3, work_status = $4, expected_resolution_at = $5,
                deadline_revised = deadline_revised OR ($6 AND expected_resolution_at IS NOT NULL)
          WHERE house_id = $1 AND id = $2`,
        [member.houseId, before.id, title ?? before.title, body.workStatus ?? before.work_status, deadline, deadlineChanged],
      );
      const after = (await readAccident(client, member.houseId, before.id))!;
      // Жильцам, которые сообщили о проблеме, — что изменилось в работах.
      const change = statusChanged && after.work_status === 'repairing' ? `Начались аварийные работы: ${after.title}`
        : deadlineChanged && deadline ? `${before.expected_resolution_at ? 'Новый срок' : 'Назначен срок'}: ${after.title}`
        : deadlineChanged ? `Срок уточняется: ${after.title}`
        : null;
      if (change) {
        await notifyResidents(client, await affectedResidentIds(client, after.id), {
          kind: 'accident', houseId: member.houseId, accidentId: after.id, title: change, body: 'Подробности — в карточке Аварии',
        }, member.residentId);
      }
      return { event: await detailsFor(client, after, member.residentId) };
    });
    if ('error' in updated) {
      return updated.error === 404
        ? reply.code(404).send({ error: 'event_not_found' })
        : reply.code(409).send({ error: 'accident_already_resolved' });
    }
    return { event: updated.event };
  });

  // «У меня тоже» на Аварии: Жилец подтверждает проблему без своей Заявки.
  for (const method of ['POST', 'DELETE'] as const) {
    app.route<{ Params: EventParams }>({
      method,
      url: '/api/houses/:houseId/events/:eventId/confirm',
      preHandler: authenticated,
      schema: { params: eventParams },
      handler: async (request, reply) => {
        const member = await access(request.authSession!.resident.id, request.params.houseId);
        if (!member) return reply.code(403).send({ error: 'forbidden' });
        const result = await inTransaction(pool, async (client) => {
          const accident = await readAccident(client, member.houseId, request.params.eventId, true);
          if (!accident) return { error: 404 as const };
          if (accident.resolved_at) return { error: 409 as const };
          if (method === 'POST') {
            await client.query(
              'INSERT INTO accident_confirmations (accident_id, resident_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [accident.id, member.residentId],
            );
          } else {
            await client.query('DELETE FROM accident_confirmations WHERE accident_id = $1 AND resident_id = $2', [accident.id, member.residentId]);
          }
          return { event: await detailsFor(client, accident, member.residentId) };
        });
        if ('error' in result) {
          return result.error === 404
            ? reply.code(404).send({ error: 'event_not_found' })
            : reply.code(409).send({ error: 'accident_already_resolved' });
        }
        return { event: result.event };
      },
    });
  }

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
      const notified = new Set<string>();
      for (const request of closed.rows) {
        await client.query(
          "INSERT INTO request_status_changes (request_id, status, note, actor_resident_id) VALUES ($1, 'closed', 'Авария устранена', NULL)",
          [request.id],
        );
        const recipients = [request.author_resident_id, ...await supporterIds(client, request.id)];
        recipients.forEach((id) => notified.add(id));
        await notifyResidents(client, recipients, {
          kind: 'request-status', houseId: member.houseId, requestId: request.id,
          title: `Заявка № ${request.number} закрыта`, body: `Авария «${accident.title}» устранена`,
        }, member.residentId);
      }
      // Кто отметил «У меня тоже» на самой Аварии, без Заявки, — тоже узнают.
      const confirmers = (await affectedResidentIds(client, accident.id)).filter((id) => !notified.has(id));
      await notifyResidents(client, confirmers, {
        kind: 'accident', houseId: member.houseId, accidentId: accident.id, title: `Авария устранена: ${accident.title}`,
      }, member.residentId);
      const row = await readAccident(client, member.houseId, accident.id);
      return row ? detailsFor(client, row, member.residentId) : null;
    });
    if (!resolved) {
      const existing = await readAccident(pool, member.houseId, request.params.eventId);
      return existing
        ? reply.code(409).send({ error: 'accident_already_resolved' })
        : reply.code(404).send({ error: 'event_not_found' });
    }
    return { event: resolved };
  });
}
