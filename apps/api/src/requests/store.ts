import type { Pool, PoolClient } from 'pg';
import type {
  RequestAction,
  RequestComment,
  RequestDetails,
  RequestInput,
  RequestPlace,
  RequestStatus,
  RequestStatusChange,
  RequestSummary,
} from '@maxtown/shared';
import {
  allowedRequestActions,
  canComment,
  canSupport,
  findSubcategory,
  isHouseSystem,
  nextStatus,
  requestTitle,
  validateRequestKind,
  type RequestViewer,
} from '@maxtown/shared/requests';
import { notifyResidents, processorIds, supporterIds, type InAppNotification } from '../notifications/in-app.ts';
import { checkThreshold, openAccidentId } from './threshold.ts';

// Заявки Дома (docs/adr/0012). Заявку о Квартире видят автор, УК и
// Администратор Дома; Заявку об Общем имуществе — все участники Дома, но без
// имени и Квартиры автора. Обрабатывают УК и Администратор Дома.

type Db = Pool | PoolClient;

/** Кто работает с Заявками: участник Дома и обрабатывает ли он Заявки. */
export type RequestContext = {
  houseId: string;
  residentId: string;
  residentName: string;
  /** УК или Администратор Дома. */
  processor: boolean;
  /** Квартира из членства; для Заявки о Квартире, если номер не указан. */
  apartmentNumber: string | null;
};

/** Ожидаемый отказ: код уходит клиенту как `{ error }`. */
export class RequestProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const PHOTO_LIMIT = 4;
export const PHOTO_MAX_BYTES = 1_572_864;
const LIST_LIMIT = 200;
const OPEN_STATUSES = "('new', 'in-progress')";

type RequestRow = {
  id: string;
  house_id: string;
  number: number;
  author_resident_id: string;
  author_name: string;
  category: string;
  subcategory: string | null;
  place: RequestPlace;
  apartment_number: string | null;
  title: string;
  description: string;
  status: RequestStatus;
  preferred_visit_date: string | null;
  visit_scheduled_at: Date | null;
  responsible_resident_id: string | null;
  responsible_name: string | null;
  accident_id: string | null;
  updated_at: Date;
  support_count: number;
  supported_by_me: boolean;
};

/** $1 — Дом, $2 — кто смотрит. */
const SELECT_REQUEST = `
  SELECT r.id, r.house_id, r.number, r.author_resident_id, author.display_name AS author_name,
         r.category, r.subcategory, r.place, r.apartment_number, r.title, r.description, r.status,
         r.preferred_visit_date::text AS preferred_visit_date, r.visit_scheduled_at,
         r.responsible_resident_id, responsible.display_name AS responsible_name,
         r.accident_id, r.updated_at,
         (SELECT count(*)::int FROM request_supporters s WHERE s.request_id = r.id) AS support_count,
         EXISTS (SELECT 1 FROM request_supporters s WHERE s.request_id = r.id AND s.resident_id = $2) AS supported_by_me
    FROM requests r
    JOIN residents author ON author.id = r.author_resident_id
    LEFT JOIN residents responsible ON responsible.id = r.responsible_resident_id`;

function viewerOf(context: RequestContext, row: Pick<RequestRow, 'author_resident_id'>): RequestViewer {
  return { author: row.author_resident_id === context.residentId, processor: context.processor };
}

function toSummary(row: RequestRow, context: RequestContext): RequestSummary {
  return {
    id: row.id,
    number: row.number,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    status: row.status,
    place: row.place,
    supportCount: row.support_count,
    relation: row.author_resident_id === context.residentId ? 'author' : row.supported_by_me ? 'supporter' : 'none',
    updatedAt: row.updated_at.toISOString(),
  };
}

export function photoUrl(houseId: string, requestId: string, photoId: string): string {
  return `/api/houses/${houseId}/requests/${requestId}/photos/${photoId}`;
}

/** Заявки в списке: УК и Администратор видят все, остальные — свои и отмеченные «У меня тоже». */
export async function listRequests(db: Db, context: RequestContext): Promise<RequestSummary[]> {
  const result = await db.query<RequestRow>(
    `${SELECT_REQUEST}
      WHERE r.house_id = $1
        AND ($3 OR r.author_resident_id = $2
             OR EXISTS (SELECT 1 FROM request_supporters s WHERE s.request_id = r.id AND s.resident_id = $2))
      ORDER BY r.updated_at DESC, r.number DESC
      LIMIT ${LIST_LIMIT}`,
    [context.houseId, context.residentId, context.processor],
  );
  return result.rows.map((row) => toSummary(row, context));
}

/**
 * Проблемы Дома: открытые Заявки об Общем имуществе, новые сверху. Заявка,
 * привязанная к Аварии, — уже часть Аварии: её показывает панель режима ЧС.
 */
export async function listHouseProblems(db: Db, context: RequestContext): Promise<RequestSummary[]> {
  const result = await db.query<RequestRow>(
    `${SELECT_REQUEST}
      WHERE r.house_id = $1 AND r.place = 'common-property' AND r.status IN ${OPEN_STATUSES} AND r.accident_id IS NULL
      ORDER BY r.created_at DESC, r.number DESC
      LIMIT ${LIST_LIMIT}`,
    [context.houseId, context.residentId],
  );
  return result.rows.map((row) => toSummary(row, context));
}

/** Строка Заявки, если тот, кто смотрит, её видит. lock — заблокировать до конца транзакции. */
async function findRow(db: Db, context: RequestContext, requestId: string, lock = false): Promise<RequestRow | null> {
  const result = await db.query<RequestRow>(
    `${SELECT_REQUEST}
      WHERE r.house_id = $1 AND r.id = $3
        AND ($4 OR r.author_resident_id = $2 OR r.place = 'common-property')
      ${lock ? 'FOR UPDATE OF r' : ''}`,
    [context.houseId, context.residentId, requestId, context.processor],
  );
  return result.rows[0] ?? null;
}

async function requireRow(db: Db, context: RequestContext, requestId: string, lock = false): Promise<RequestRow> {
  const row = await findRow(db, context, requestId, lock);
  if (!row) throw new RequestProblem(404, 'request_not_found');
  return row;
}

/** Карточка Заявки под того, кто смотрит; невидимая — null. */
export async function readRequest(db: Db, context: RequestContext, requestId: string): Promise<RequestDetails | null> {
  const row = await findRow(db, context, requestId);
  return row ? toDetails(db, context, row) : null;
}

async function toDetails(db: Db, context: RequestContext, row: RequestRow): Promise<RequestDetails> {
  const viewer = viewerOf(context, row);
  const history = await db.query<{ status: RequestStatus; note: string | null; created_at: Date }>(
    'SELECT status, note, created_at FROM request_status_changes WHERE request_id = $1 ORDER BY id',
    [row.id],
  );
  const comments = await db.query<{
    id: string; author_resident_id: string; author_name: string; author_role: RequestComment['authorRole'];
    body: string; created_at: Date;
  }>(
    `SELECT c.id, c.author_resident_id, author.display_name AS author_name, c.author_role, c.body, c.created_at
       FROM request_comments c JOIN residents author ON author.id = c.author_resident_id
      WHERE c.request_id = $1 ORDER BY c.seq`,
    [row.id],
  );
  const photos = await db.query<{ id: string }>(
    'SELECT id FROM request_photos WHERE request_id = $1 ORDER BY position',
    [row.id],
  );
  const insider = viewer.author || viewer.processor;
  const preferredDate = row.preferred_visit_date ?? row.visit_scheduled_at?.toISOString().slice(0, 10) ?? null;

  return {
    ...toSummary(row, context),
    description: row.description,
    ...(insider && row.apartment_number ? { apartment: row.apartment_number } : {}),
    ...(viewer.processor ? { authorName: row.author_name } : {}),
    ...(row.responsible_name ? { responsibleName: row.responsible_name } : {}),
    ...(row.place === 'apartment' && preferredDate
      ? { visit: { preferredDate, ...(row.visit_scheduled_at ? { scheduledAt: row.visit_scheduled_at.toISOString() } : {}) } }
      : {}),
    photos: photos.rows.map((photo) => ({ id: photo.id, url: photoUrl(row.house_id, row.id, photo.id) })),
    history: history.rows.map((change): RequestStatusChange => ({
      status: change.status,
      at: change.created_at.toISOString(),
      ...(change.note ? { note: change.note } : {}),
    })),
    comments: comments.rows.map((comment): RequestComment => {
      const mine = comment.author_resident_id === context.residentId;
      // Соседи не видят, кто подал Заявку: Комментарии автора подписаны «Жилец».
      const authorName = mine ? 'Вы'
        : comment.author_role === 'responsible' || viewer.processor ? comment.author_name
        : 'Жилец';
      return { id: comment.id, authorName, authorRole: comment.author_role, mine, text: comment.body, at: comment.created_at.toISOString() };
    }),
    ...(row.accident_id ? { accidentId: row.accident_id } : {}),
    actions: allowedRequestActions(row, viewer),
    canSupport: canSupport(row, viewer),
    supportedByMe: row.supported_by_me,
    canComment: canComment(row.status, viewer),
  };
}

/** Прочитать Заявку заново после изменения — уже с новым статусом и историей. */
export async function reloadRequest(db: Db, context: RequestContext, requestId: string): Promise<RequestDetails> {
  return toDetails(db, context, await requireRow(db, context, requestId));
}

function validVisitDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  // Вчера ещё допустимо: у телефона может быть другой часовой пояс.
  return date.getTime() >= Date.now() - 2 * 24 * 60 * 60 * 1000;
}

/** Уведомить автора и отметивших «У меня тоже». */
async function notifyFollowers(client: PoolClient, row: RequestRow, context: RequestContext, notification: Omit<InAppNotification, 'houseId' | 'requestId'>): Promise<void> {
  await notifyResidents(
    client,
    [row.author_resident_id, ...await supporterIds(client, row.id)],
    { ...notification, houseId: row.house_id, requestId: row.id },
    context.residentId,
  );
}

/** Уведомить Ответственного, а пока Заявку никто не взял — всех УК и Администраторов. */
async function notifyResponsible(client: PoolClient, row: RequestRow, context: RequestContext, notification: Omit<InAppNotification, 'houseId' | 'requestId'>): Promise<void> {
  const recipients = row.responsible_resident_id ? [row.responsible_resident_id] : await processorIds(client, row.house_id);
  await notifyResidents(client, recipients, { ...notification, houseId: row.house_id, requestId: row.id }, context.residentId);
}

async function recordStatus(client: PoolClient, requestId: string, status: RequestStatus, actorResidentId: string | null, note?: string): Promise<void> {
  await client.query(
    'INSERT INTO request_status_changes (request_id, status, note, actor_resident_id) VALUES ($1, $2, $3, $4)',
    [requestId, status, note ?? null, actorResidentId],
  );
}

/**
 * Создать Заявку. Блокирует строку Дома: номер и Порог считаются по очереди.
 * Заявка о Системе с открытой Аварией сразу привязывается к ней.
 */
export async function createRequest(client: PoolClient, context: RequestContext, input: RequestInput): Promise<string> {
  const description = input.description.trim();
  const subcategory = input.subcategory?.trim() || null;
  // Лифт в Квартире или подкатегория из другой Категории — ошибка запроса.
  const kindProblem = validateRequestKind(input.category, input.place, subcategory);
  if (kindProblem) throw new RequestProblem(400, kindProblem);
  if (description.length < 10 || description.length > 500) throw new RequestProblem(400, 'description_invalid');

  const apartment = input.place === 'apartment' ? (input.apartmentNumber?.trim() || context.apartmentNumber) : null;
  if (input.place === 'apartment' && !apartment) throw new RequestProblem(400, 'apartment_required');
  const preferredVisitDate = input.place === 'apartment' ? input.preferredVisitDate ?? null : null;
  if (preferredVisitDate && !validVisitDate(preferredVisitDate)) throw new RequestProblem(400, 'visit_date_invalid');

  const numbered = await client.query<{ number: number }>(
    'UPDATE houses SET next_request_number = next_request_number + 1 WHERE id = $1 RETURNING next_request_number - 1 AS number',
    [context.houseId],
  );
  const number = numbered.rows[0]?.number;
  if (!number) throw new RequestProblem(404, 'house_not_found');

  const system = isHouseSystem(input.category) ? input.category : null;
  const accidentId = system ? await openAccidentId(client, context.houseId, system) : null;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO requests (house_id, number, author_resident_id, category, subcategory, place, apartment_number, title,
                           description, preferred_visit_date, accident_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [context.houseId, number, context.residentId, input.category, subcategory, input.place, apartment,
      requestTitle(description), description, preferredVisitDate, accidentId],
  );
  const requestId = inserted.rows[0]!.id;
  await recordStatus(client, requestId, 'new', context.residentId);
  await notifyResidents(client, await processorIds(client, context.houseId), {
    kind: 'request-new',
    houseId: context.houseId,
    requestId,
    title: `Новая Заявка № ${number} · ${input.category}`,
    body: [findSubcategory(input.category, subcategory)?.label, requestTitle(description)].filter(Boolean).join(': '),
  }, context.residentId);

  if (system && !accidentId) await checkThreshold(client, context.houseId, system);
  return requestId;
}

export type RequestActionInput = { action: RequestAction; note?: string; scheduledAt?: string };

/** Действие с Заявкой по общим правилам статусов (packages/shared/src/requests.ts). */
export async function applyRequestAction(client: PoolClient, context: RequestContext, requestId: string, input: RequestActionInput): Promise<void> {
  const row = await requireRow(client, context, requestId, true);
  const viewer = viewerOf(context, row);
  if (!allowedRequestActions(row, viewer).includes(input.action)) throw new RequestProblem(409, 'request_action_not_allowed');
  const next = nextStatus(row.status, input.action)!;
  const note = input.note?.trim() || undefined;
  const number = row.number;

  switch (input.action) {
    case 'take': {
      await client.query(
        "UPDATE requests SET status = 'in-progress', responsible_resident_id = $2, updated_at = now() WHERE id = $1",
        [row.id, context.residentId],
      );
      await recordStatus(client, row.id, next, context.residentId, `Ответственный: ${context.residentName}`);
      await notifyFollowers(client, row, context, {
        kind: 'request-status', title: `Заявка № ${number} взята в работу`, body: `Ответственный: ${context.residentName}`,
      });
      return;
    }
    case 'schedule-visit': {
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime())) throw new RequestProblem(400, 'visit_time_required');
      await client.query('UPDATE requests SET visit_scheduled_at = $2, updated_at = now() WHERE id = $1', [row.id, scheduledAt]);
      await notifyResidents(client, [row.author_resident_id], {
        kind: 'request-visit', houseId: row.house_id, requestId: row.id,
        title: `Назначен Визит по Заявке № ${number}`, body: 'Время Визита — в карточке Заявки',
      }, context.residentId);
      return;
    }
    case 'complete': {
      await client.query(
        "UPDATE requests SET status = 'done', done_at = now(), reminded_at = NULL, updated_at = now() WHERE id = $1",
        [row.id],
      );
      await recordStatus(client, row.id, next, context.residentId);
      await notifyResidents(client, [row.author_resident_id], {
        kind: 'request-status', houseId: row.house_id, requestId: row.id,
        title: `Заявка № ${number} выполнена`, body: 'Проверьте и подтвердите исправление',
      }, context.residentId);
      await notifyResidents(client, await supporterIds(client, row.id), {
        kind: 'request-status', houseId: row.house_id, requestId: row.id,
        title: `Заявка № ${number} выполнена`, body: 'Ответственный сообщил, что всё исправлено',
      }, context.residentId);
      return;
    }
    case 'reject': {
      if (!note) throw new RequestProblem(400, 'reason_required');
      await client.query("UPDATE requests SET status = 'rejected', updated_at = now() WHERE id = $1", [row.id]);
      await recordStatus(client, row.id, next, context.residentId, note);
      await notifyFollowers(client, row, context, { kind: 'request-status', title: `Заявка № ${number} отклонена`, body: note });
      return;
    }
    case 'cancel': {
      await client.query("UPDATE requests SET status = 'cancelled', updated_at = now() WHERE id = $1", [row.id]);
      await recordStatus(client, row.id, next, context.residentId);
      const recipients = [...(row.responsible_resident_id ? [row.responsible_resident_id] : []), ...await supporterIds(client, row.id)];
      await notifyResidents(client, recipients, {
        kind: 'request-status', houseId: row.house_id, requestId: row.id,
        title: `Заявка № ${number} отменена`, body: 'Жилец отозвал Заявку',
      }, context.residentId);
      return;
    }
    case 'confirm': {
      await client.query("UPDATE requests SET status = 'closed', updated_at = now() WHERE id = $1", [row.id]);
      await recordStatus(client, row.id, next, context.residentId);
      if (row.responsible_resident_id) {
        await notifyResidents(client, [row.responsible_resident_id], {
          kind: 'request-status', houseId: row.house_id, requestId: row.id,
          title: `Заявка № ${number} закрыта`, body: 'Жилец подтвердил исправление',
        }, context.residentId);
      }
      await notifyResidents(client, await supporterIds(client, row.id), {
        kind: 'request-status', houseId: row.house_id, requestId: row.id,
        title: `Заявка № ${number} закрыта`, body: 'Исправление подтверждено',
      }, context.residentId);
      return;
    }
    case 'not-fixed': {
      await client.query(
        "UPDATE requests SET status = 'in-progress', done_at = NULL, reminded_at = NULL, updated_at = now() WHERE id = $1",
        [row.id],
      );
      await recordStatus(client, row.id, next, context.residentId, 'Жилец ответил: не исправлено');
      if (note) {
        await client.query(
          "INSERT INTO request_comments (request_id, author_resident_id, author_role, body) VALUES ($1, $2, 'resident', $3)",
          [row.id, context.residentId, note.slice(0, 1000)],
        );
      }
      await notifyResponsible(client, row, context, {
        kind: 'request-status', title: `Заявка № ${number} вернулась в работу`, body: note ?? 'Жилец ответил: не исправлено',
      });
      await notifyResidents(client, await supporterIds(client, row.id), {
        kind: 'request-status', houseId: row.house_id, requestId: row.id,
        title: `Заявка № ${number} вернулась в работу`, body: 'Жилец ответил, что не исправлено',
      }, context.residentId);
      return;
    }
  }
}

/** Комментарий пишут автор и УК или Администратор, пока Заявка не закрыта и не отменена. */
export async function addRequestComment(client: PoolClient, context: RequestContext, requestId: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body) throw new RequestProblem(400, 'comment_empty');
  const row = await requireRow(client, context, requestId, true);
  const viewer = viewerOf(context, row);
  if (!canComment(row.status, viewer)) throw new RequestProblem(409, 'comment_not_allowed');
  const role = viewer.author ? 'resident' : 'responsible';
  await client.query(
    'INSERT INTO request_comments (request_id, author_resident_id, author_role, body) VALUES ($1, $2, $3, $4)',
    [row.id, context.residentId, role, body.slice(0, 1000)],
  );
  await client.query('UPDATE requests SET updated_at = now() WHERE id = $1', [row.id]);
  const notification = { kind: 'request-comment' as const, title: `Комментарий к Заявке № ${row.number}`, body };
  if (role === 'responsible') {
    await notifyResidents(client, [row.author_resident_id], { ...notification, houseId: row.house_id, requestId: row.id }, context.residentId);
  } else {
    await notifyResponsible(client, row, context, notification);
  }
}

/**
 * Поставить или снять «У меня тоже». Блокирует строку Дома, как создание
 * Заявки: отметка может перейти Порог и открыть Аварию.
 */
export async function setRequestSupport(client: PoolClient, context: RequestContext, requestId: string, supported: boolean): Promise<void> {
  await client.query('SELECT id FROM houses WHERE id = $1 FOR UPDATE', [context.houseId]);
  const row = await requireRow(client, context, requestId, true);
  if (!supported) {
    await client.query('DELETE FROM request_supporters WHERE request_id = $1 AND resident_id = $2', [row.id, context.residentId]);
    return;
  }
  if (!canSupport(row, viewerOf(context, row))) throw new RequestProblem(409, 'support_not_allowed');
  const inserted = await client.query(
    'INSERT INTO request_supporters (request_id, resident_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING request_id',
    [row.id, context.residentId],
  );
  if (inserted.rowCount && isHouseSystem(row.category) && !row.accident_id) {
    await checkThreshold(client, context.houseId, row.category);
  }
}

/** Тип картинки по первым байтам: заголовку Content-Type не верим. */
export function detectImageType(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Фото прикладывает автор, пока Заявку не взяли в работу; не больше четырёх. */
export async function addRequestPhoto(client: PoolClient, context: RequestContext, requestId: string, data: Buffer): Promise<string> {
  const row = await requireRow(client, context, requestId, true);
  if (!viewerOf(context, row).author || row.status !== 'new') throw new RequestProblem(409, 'photo_not_allowed');
  const contentType = detectImageType(data);
  if (!contentType) throw new RequestProblem(415, 'unsupported_photo');
  if (data.length > PHOTO_MAX_BYTES) throw new RequestProblem(413, 'photo_too_large');
  const existing = await client.query<{ count: number; position: number }>(
    'SELECT count(*)::int AS count, coalesce(max(position), 0)::int AS position FROM request_photos WHERE request_id = $1',
    [row.id],
  );
  const { count, position } = existing.rows[0]!;
  if (count >= PHOTO_LIMIT) throw new RequestProblem(409, 'photo_limit_reached');
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO request_photos (request_id, position, content_type, data) VALUES ($1, $2, $3, $4) RETURNING id',
    [row.id, position + 1, contentType, data],
  );
  return inserted.rows[0]!.id;
}

/** Фото Заявки — тому, кто видит саму Заявку. */
export async function readRequestPhoto(db: Db, context: RequestContext, requestId: string, photoId: string): Promise<{ contentType: string; data: Buffer } | null> {
  if (!(await findRow(db, context, requestId))) return null;
  const result = await db.query<{ content_type: string; data: Buffer }>(
    'SELECT content_type, data FROM request_photos WHERE request_id = $1 AND id = $2',
    [requestId, photoId],
  );
  const photo = result.rows[0];
  return photo ? { contentType: photo.content_type, data: photo.data } : null;
}
