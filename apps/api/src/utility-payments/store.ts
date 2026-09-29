import type { Pool, PoolClient } from 'pg';
import type {
  UtilityPaymentCategory,
  UtilityPaymentEvent,
  UtilityPaymentEventAction,
  UtilityPaymentPeriod,
  UtilityPaymentPeriodInput,
  UtilityPaymentPeriodsPage,
  UtilityPaymentsOverview,
  UtilityPaymentTemplate,
  UtilityPaymentTemplateInput,
} from '@maxtown/shared';
import { UTILITY_PAYMENT_CATEGORIES } from '@maxtown/shared';
import { detectImageType } from '../requests/store.ts';
import { dueDateForMonth, houseDate, monthStart, utilityPaymentState } from './model.ts';

type Db = Pool | PoolClient;

export const RECEIPT_MAX_BYTES = 5_242_880;
export const PERIOD_PAGE_SIZE = 24;

export type UtilityPaymentContext = {
  houseId: string;
  apartmentId: string;
  apartmentNumber: string;
  membershipId: string;
  residentName: string;
};

export class UtilityPaymentProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type TemplateRow = {
  id: string; house_id: string; apartment_id: string; category: UtilityPaymentCategory; title: string;
  due_day: number; starts_on: string; archived_at: Date | null; version: number; created_at: Date; updated_at: Date;
};

type PeriodRow = {
  id: string; template_id: string; house_id: string; apartment_id: string; billing_month: string;
  category: UtilityPaymentCategory; title: string; due_on: string; paid_at: Date | null; skipped_at: Date | null;
  version: number; created_at: Date; receipt_file_name: string | null; receipt_content_type: string | null;
  receipt_size: number | null; receipt_uploaded_at: Date | null; receipt_uploaded_by: string | null;
};

const periodSelect = `SELECT period.id, period.template_id, period.house_id, period.apartment_id,
  period.billing_month::text, period.category, period.title, period.due_on::text,
  period.paid_at, period.skipped_at, period.version, period.created_at,
  receipt.file_name AS receipt_file_name, receipt.content_type AS receipt_content_type,
  CASE WHEN receipt.data IS NULL THEN NULL ELSE octet_length(receipt.data) END::int AS receipt_size,
  receipt.uploaded_at AS receipt_uploaded_at, uploader.display_name AS receipt_uploaded_by
  FROM utility_payment_periods period
  LEFT JOIN utility_payment_receipts receipt ON receipt.period_id = period.id
  LEFT JOIN memberships uploader_membership ON uploader_membership.id = receipt.uploaded_by_membership_id
  LEFT JOIN residents uploader ON uploader.id = uploader_membership.resident_id`;

function toTemplate(row: TemplateRow): UtilityPaymentTemplate {
  return {
    id: row.id,
    houseId: row.house_id,
    apartmentId: row.apartment_id,
    category: row.category,
    title: row.title,
    dueDay: row.due_day,
    startsOn: row.starts_on,
    archivedAt: row.archived_at?.toISOString() ?? null,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function receiptUrl(row: Pick<PeriodRow, 'house_id' | 'id'>): string {
  return `/api/houses/${row.house_id}/utility-payments/periods/${row.id}/receipt`;
}

function toPeriod(row: PeriodRow, today: string): UtilityPaymentPeriod {
  const receipt = row.receipt_file_name && row.receipt_content_type && row.receipt_size !== null
    && row.receipt_uploaded_at && row.receipt_uploaded_by ? {
      fileName: row.receipt_file_name,
      contentType: row.receipt_content_type as NonNullable<UtilityPaymentPeriod['receipt']>['contentType'],
      size: row.receipt_size,
      url: receiptUrl(row),
      uploadedBy: row.receipt_uploaded_by,
      uploadedAt: row.receipt_uploaded_at.toISOString(),
    } : null;
  return {
    id: row.id,
    templateId: row.template_id,
    houseId: row.house_id,
    apartmentId: row.apartment_id,
    billingMonth: row.billing_month,
    category: row.category,
    title: row.title,
    dueOn: row.due_on,
    state: utilityPaymentState({ dueOn: row.due_on, paidAt: row.paid_at, skippedAt: row.skipped_at, today }),
    paidAt: row.paid_at?.toISOString() ?? null,
    skippedAt: row.skipped_at?.toISOString() ?? null,
    version: row.version,
    receipt,
  };
}

function normalizedTemplate(input: UtilityPaymentTemplateInput): Omit<UtilityPaymentTemplateInput, 'version'> {
  const title = input.title.trim();
  if (!(UTILITY_PAYMENT_CATEGORIES as readonly string[]).includes(input.category)
      || title.length < 1 || title.length > 120
      || !Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31
      || !/^\d{4}-\d{2}-01$/.test(input.startsOn)) {
    throw new UtilityPaymentProblem(400, 'utility_payment_invalid');
  }
  try {
    if (monthStart(input.startsOn) !== input.startsOn) throw new Error('not_month_start');
    dueDateForMonth(input.startsOn, input.dueDay);
  } catch {
    throw new UtilityPaymentProblem(400, 'utility_payment_invalid');
  }
  return { category: input.category, title, dueDay: input.dueDay, startsOn: input.startsOn };
}

async function recordEvent(
  db: Db,
  context: UtilityPaymentContext,
  action: UtilityPaymentEventAction,
  ids: { templateId?: string; periodId?: string },
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO utility_payment_events
       (house_id, apartment_id, template_id, period_id, action, actor_membership_id, actor_name, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [context.houseId, context.apartmentId, ids.templateId ?? null, ids.periodId ?? null,
      action, context.membershipId, context.residentName, JSON.stringify(details)],
  );
}

export async function ensureUtilityPaymentPeriods(db: Db, apartmentId: string, today: string): Promise<number> {
  const billingMonth = monthStart(today);
  const templates = await db.query<Pick<TemplateRow, 'id' | 'house_id' | 'apartment_id' | 'category' | 'title' | 'due_day'>>(
    `SELECT id, house_id, apartment_id, category, title, due_day
       FROM utility_payment_templates
      WHERE apartment_id = $1 AND archived_at IS NULL AND starts_on <= $2::date`,
    [apartmentId, billingMonth],
  );
  let created = 0;
  for (const template of templates.rows) {
    const result = await db.query(
      `INSERT INTO utility_payment_periods
         (template_id, house_id, apartment_id, billing_month, category, title, due_on)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7::date)
       ON CONFLICT (template_id, billing_month) DO NOTHING`,
      [template.id, template.house_id, template.apartment_id, billingMonth, template.category,
        template.title, dueDateForMonth(billingMonth, template.due_day)],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

async function templatesFor(db: Db, context: UtilityPaymentContext): Promise<UtilityPaymentTemplate[]> {
  const result = await db.query<TemplateRow>(
    `SELECT id, house_id, apartment_id, category, title, due_day, starts_on::text,
            archived_at, version, created_at, updated_at
       FROM utility_payment_templates
      WHERE house_id = $1 AND apartment_id = $2
      ORDER BY archived_at NULLS FIRST, title, id`,
    [context.houseId, context.apartmentId],
  );
  return result.rows.map(toTemplate);
}

async function periodsForMonth(db: Db, context: UtilityPaymentContext, billingMonth: string, today: string): Promise<UtilityPaymentPeriod[]> {
  const result = await db.query<PeriodRow>(
    `${periodSelect}
      WHERE period.house_id = $1 AND period.apartment_id = $2 AND period.billing_month = $3::date
      ORDER BY (period.paid_at IS NOT NULL OR period.skipped_at IS NOT NULL), period.due_on, period.title, period.id`,
    [context.houseId, context.apartmentId, billingMonth],
  );
  return result.rows.map((row) => toPeriod(row, today));
}

export async function listUtilityPaymentsOverview(
  db: Db,
  context: UtilityPaymentContext,
  now = new Date(),
): Promise<UtilityPaymentsOverview> {
  const today = houseDate(now);
  await ensureUtilityPaymentPeriods(db, context.apartmentId, today);
  return {
    apartmentId: context.apartmentId,
    apartmentNumber: context.apartmentNumber,
    today,
    periods: await periodsForMonth(db, context, monthStart(today), today),
    templates: await templatesFor(db, context),
  };
}

function encodeCursor(row: Pick<PeriodRow, 'billing_month' | 'id'>): string {
  return Buffer.from(`${row.billing_month}|${row.id}`).toString('base64url');
}

function decodeCursor(value: string | undefined): { month: string; id: string } | null {
  if (!value) return null;
  try {
    const [month, id, extra] = Buffer.from(value, 'base64url').toString().split('|');
    if (extra || !month || !/^\d{4}-\d{2}-\d{2}$/.test(month) || !id
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    return { month, id };
  } catch {
    return null;
  }
}

export async function listUtilityPaymentPeriods(
  db: Db,
  context: UtilityPaymentContext,
  year: number,
  cursorValue: string | undefined,
  now = new Date(),
): Promise<UtilityPaymentPeriodsPage> {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new UtilityPaymentProblem(400, 'utility_payment_year_invalid');
  const cursor = decodeCursor(cursorValue);
  if (cursorValue && !cursor) throw new UtilityPaymentProblem(400, 'utility_payment_cursor_invalid');
  const result = await db.query<PeriodRow>(
    `${periodSelect}
      WHERE period.house_id = $1 AND period.apartment_id = $2
        AND period.billing_month >= $3::date AND period.billing_month < ($3::date + interval '1 year')
        AND ($4::date IS NULL OR (period.billing_month, period.id) < ($4::date, $5::uuid))
      ORDER BY period.billing_month DESC, period.id DESC LIMIT $6`,
    [context.houseId, context.apartmentId, `${year}-01-01`, cursor?.month ?? null, cursor?.id ?? null, PERIOD_PAGE_SIZE + 1],
  );
  const page = result.rows.slice(0, PERIOD_PAGE_SIZE);
  return {
    periods: page.map((row) => toPeriod(row, houseDate(now))),
    nextCursor: result.rows.length > PERIOD_PAGE_SIZE && page.at(-1) ? encodeCursor(page.at(-1)!) : null,
  };
}

async function findPeriod(db: Db, context: UtilityPaymentContext, periodId: string, lock = false): Promise<PeriodRow | null> {
  const result = await db.query<PeriodRow>(
    `${periodSelect}
      WHERE period.id = $1 AND period.house_id = $2 AND period.apartment_id = $3${lock ? ' FOR UPDATE OF period' : ''}`,
    [periodId, context.houseId, context.apartmentId],
  );
  return result.rows[0] ?? null;
}

async function requirePeriod(db: Db, context: UtilityPaymentContext, periodId: string, lock = false): Promise<PeriodRow> {
  const row = await findPeriod(db, context, periodId, lock);
  if (!row) throw new UtilityPaymentProblem(404, 'utility_payment_not_found');
  return row;
}

async function eventsFor(db: Db, periodId: string): Promise<UtilityPaymentEvent[]> {
  const result = await db.query<{ id: string; action: UtilityPaymentEventAction; actor_name: string; created_at: Date }>(
    `SELECT id::text, action, actor_name, created_at FROM utility_payment_events
      WHERE period_id = $1 ORDER BY id`,
    [periodId],
  );
  return result.rows.map((row) => ({ id: row.id, action: row.action, actorName: row.actor_name, at: row.created_at.toISOString() }));
}

export async function readUtilityPaymentPeriod(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
  now = new Date(),
): Promise<UtilityPaymentPeriod | null> {
  const row = await findPeriod(db, context, periodId);
  if (!row) return null;
  return { ...toPeriod(row, houseDate(now)), events: await eventsFor(db, row.id) };
}

export async function createUtilityPaymentTemplate(
  db: Db,
  context: UtilityPaymentContext,
  input: UtilityPaymentTemplateInput,
  now = new Date(),
): Promise<UtilityPaymentTemplate> {
  const value = normalizedTemplate(input);
  const result = await db.query<TemplateRow>(
    `INSERT INTO utility_payment_templates
       (house_id, apartment_id, category, title, due_day, starts_on, created_by_membership_id, updated_by_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $7)
     RETURNING id, house_id, apartment_id, category, title, due_day, starts_on::text,
               archived_at, version, created_at, updated_at`,
    [context.houseId, context.apartmentId, value.category, value.title, value.dueDay, value.startsOn, context.membershipId],
  );
  const row = result.rows[0]!;
  await recordEvent(db, context, 'template-created', { templateId: row.id });
  if (value.startsOn <= monthStart(houseDate(now))) await ensureUtilityPaymentPeriods(db, context.apartmentId, houseDate(now));
  return toTemplate(row);
}

async function requireTemplate(db: Db, context: UtilityPaymentContext, templateId: string, lock = false): Promise<TemplateRow> {
  const result = await db.query<TemplateRow>(
    `SELECT id, house_id, apartment_id, category, title, due_day, starts_on::text,
            archived_at, version, created_at, updated_at
       FROM utility_payment_templates
      WHERE id = $1 AND house_id = $2 AND apartment_id = $3${lock ? ' FOR UPDATE' : ''}`,
    [templateId, context.houseId, context.apartmentId],
  );
  if (!result.rows[0]) throw new UtilityPaymentProblem(404, 'utility_payment_template_not_found');
  return result.rows[0];
}

export async function updateUtilityPaymentTemplate(
  db: Db,
  context: UtilityPaymentContext,
  templateId: string,
  input: UtilityPaymentTemplateInput,
  now = new Date(),
): Promise<UtilityPaymentTemplate> {
  const value = normalizedTemplate(input);
  const current = await requireTemplate(db, context, templateId, true);
  if (current.archived_at) throw new UtilityPaymentProblem(409, 'utility_payment_template_archived');
  if (!input.version || input.version !== current.version) throw new UtilityPaymentProblem(409, 'utility_payment_version_conflict');
  const result = await db.query<TemplateRow>(
    `UPDATE utility_payment_templates
        SET category = $4, title = $5, due_day = $6, starts_on = $7::date,
            updated_by_membership_id = $8, updated_at = $9, version = version + 1
      WHERE id = $1 AND house_id = $2 AND apartment_id = $3
      RETURNING id, house_id, apartment_id, category, title, due_day, starts_on::text,
                archived_at, version, created_at, updated_at`,
    [templateId, context.houseId, context.apartmentId, value.category, value.title, value.dueDay,
      value.startsOn, context.membershipId, now],
  );
  const billingMonth = monthStart(houseDate(now));
  await db.query(
    `UPDATE utility_payment_periods
        SET category = $2, title = $3, due_on = $4::date, updated_at = $5, version = version + 1
      WHERE template_id = $1 AND billing_month = $6::date AND paid_at IS NULL AND skipped_at IS NULL`,
    [templateId, value.category, value.title, dueDateForMonth(billingMonth, value.dueDay), now, billingMonth],
  );
  await recordEvent(db, context, 'template-updated', { templateId });
  if (value.startsOn <= billingMonth) await ensureUtilityPaymentPeriods(db, context.apartmentId, houseDate(now));
  return toTemplate(result.rows[0]!);
}

export async function archiveUtilityPaymentTemplate(
  db: Db,
  context: UtilityPaymentContext,
  templateId: string,
  version: number,
  now = new Date(),
): Promise<UtilityPaymentTemplate> {
  const current = await requireTemplate(db, context, templateId, true);
  if (current.archived_at) return toTemplate(current);
  if (version !== current.version) throw new UtilityPaymentProblem(409, 'utility_payment_version_conflict');
  const result = await db.query<TemplateRow>(
    `UPDATE utility_payment_templates
        SET archived_at = $4, updated_at = $4, updated_by_membership_id = $5, version = version + 1
      WHERE id = $1 AND house_id = $2 AND apartment_id = $3
      RETURNING id, house_id, apartment_id, category, title, due_day, starts_on::text,
                archived_at, version, created_at, updated_at`,
    [templateId, context.houseId, context.apartmentId, now, context.membershipId],
  );
  await recordEvent(db, context, 'template-archived', { templateId });
  return toTemplate(result.rows[0]!);
}

function validatePeriodInput(input: UtilityPaymentPeriodInput, row: PeriodRow): { title: string; dueOn: string } {
  const title = input.title?.trim() || row.title;
  const dueOn = input.dueOn ?? row.due_on;
  if (title.length < 1 || title.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)
      || dueOn.slice(0, 7) !== row.billing_month.slice(0, 7)) {
    throw new UtilityPaymentProblem(400, 'utility_payment_invalid');
  }
  try {
    utilityPaymentState({ dueOn, paidAt: null, skippedAt: null, today: dueOn });
  } catch {
    throw new UtilityPaymentProblem(400, 'utility_payment_invalid');
  }
  return { title, dueOn };
}

export async function updateUtilityPaymentPeriod(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
  input: UtilityPaymentPeriodInput,
  now = new Date(),
): Promise<UtilityPaymentPeriod> {
  const row = await requirePeriod(db, context, periodId, true);
  if (row.paid_at || row.skipped_at) throw new UtilityPaymentProblem(409, 'utility_payment_period_locked');
  if (input.version !== row.version) throw new UtilityPaymentProblem(409, 'utility_payment_version_conflict');
  const value = validatePeriodInput(input, row);
  await db.query(
    `UPDATE utility_payment_periods SET title = $2, due_on = $3::date, updated_at = $4, version = version + 1
      WHERE id = $1`,
    [row.id, value.title, value.dueOn, now],
  );
  await recordEvent(db, context, 'period-updated', { templateId: row.template_id, periodId: row.id });
  return (await readUtilityPaymentPeriod(db, context, row.id, now))!;
}

export type UtilityPaymentTransition = 'paid' | 'unpaid' | 'skipped' | 'unskipped';

export async function transitionUtilityPaymentPeriod(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
  transition: UtilityPaymentTransition,
  version: number,
  now = new Date(),
): Promise<UtilityPaymentPeriod> {
  const row = await requirePeriod(db, context, periodId, true);
  if (version !== row.version) throw new UtilityPaymentProblem(409, 'utility_payment_version_conflict');
  if (transition === 'paid' && (row.paid_at || row.skipped_at)) throw new UtilityPaymentProblem(409, 'utility_payment_transition_invalid');
  if (transition === 'unpaid' && !row.paid_at) throw new UtilityPaymentProblem(409, 'utility_payment_transition_invalid');
  if (transition === 'skipped' && (row.paid_at || row.skipped_at)) throw new UtilityPaymentProblem(409, 'utility_payment_transition_invalid');
  if (transition === 'unskipped' && !row.skipped_at) throw new UtilityPaymentProblem(409, 'utility_payment_transition_invalid');

  if (transition === 'paid') {
    await db.query('UPDATE utility_payment_periods SET paid_at = $2, paid_by_membership_id = $3, updated_at = $2, version = version + 1 WHERE id = $1', [row.id, now, context.membershipId]);
  } else if (transition === 'unpaid') {
    await db.query('DELETE FROM utility_payment_receipts WHERE period_id = $1', [row.id]);
    await db.query('UPDATE utility_payment_periods SET paid_at = NULL, paid_by_membership_id = NULL, updated_at = $2, version = version + 1 WHERE id = $1', [row.id, now]);
  } else if (transition === 'skipped') {
    await db.query('UPDATE utility_payment_periods SET skipped_at = $2, skipped_by_membership_id = $3, updated_at = $2, version = version + 1 WHERE id = $1', [row.id, now, context.membershipId]);
  } else {
    await db.query('UPDATE utility_payment_periods SET skipped_at = NULL, skipped_by_membership_id = NULL, updated_at = $2, version = version + 1 WHERE id = $1', [row.id, now]);
  }
  if (transition === 'paid' || transition === 'skipped') {
    await db.query(
      'UPDATE in_app_notifications SET read_at = COALESCE(read_at, $2) WHERE utility_payment_period_id = $1 AND read_at IS NULL',
      [row.id, now],
    );
  }
  await recordEvent(db, context, transition, { templateId: row.template_id, periodId: row.id });
  return (await readUtilityPaymentPeriod(db, context, row.id, now))!;
}

export function detectUtilityPaymentReceiptType(data: Buffer): NonNullable<UtilityPaymentPeriod['receipt']>['contentType'] | null {
  const image = detectImageType(data);
  if (image) return image;
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export async function saveUtilityPaymentReceipt(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
  fileNameValue: string,
  data: Buffer,
  now = new Date(),
): Promise<UtilityPaymentPeriod> {
  const row = await requirePeriod(db, context, periodId, true);
  if (!row.paid_at) throw new UtilityPaymentProblem(409, 'utility_payment_receipt_requires_paid');
  if (data.length < 1 || data.length > RECEIPT_MAX_BYTES) throw new UtilityPaymentProblem(413, 'utility_payment_receipt_too_large');
  const contentType = detectUtilityPaymentReceiptType(data);
  if (!contentType) throw new UtilityPaymentProblem(415, 'utility_payment_receipt_unsupported');
  const fileName = fileNameValue.trim().replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255) || 'чек';
  const existing = await db.query('SELECT 1 FROM utility_payment_receipts WHERE period_id = $1', [row.id]);
  await db.query(
    `INSERT INTO utility_payment_receipts
       (period_id, house_id, file_name, content_type, data, uploaded_by_membership_id, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (period_id) DO UPDATE SET file_name = EXCLUDED.file_name,
       content_type = EXCLUDED.content_type, data = EXCLUDED.data,
       uploaded_by_membership_id = EXCLUDED.uploaded_by_membership_id, uploaded_at = EXCLUDED.uploaded_at`,
    [row.id, context.houseId, fileName, contentType, data, context.membershipId, now],
  );
  await recordEvent(db, context, existing.rowCount ? 'receipt-replaced' : 'receipt-added', { templateId: row.template_id, periodId: row.id }, { fileName, contentType });
  return (await readUtilityPaymentPeriod(db, context, row.id, now))!;
}

export async function deleteUtilityPaymentReceipt(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
  now = new Date(),
): Promise<UtilityPaymentPeriod> {
  const row = await requirePeriod(db, context, periodId, true);
  const deleted = await db.query('DELETE FROM utility_payment_receipts WHERE period_id = $1 RETURNING period_id', [row.id]);
  if (!deleted.rowCount) throw new UtilityPaymentProblem(404, 'utility_payment_receipt_not_found');
  await recordEvent(db, context, 'receipt-deleted', { templateId: row.template_id, periodId: row.id });
  return (await readUtilityPaymentPeriod(db, context, row.id, now))!;
}

export async function readUtilityPaymentReceipt(
  db: Db,
  context: UtilityPaymentContext,
  periodId: string,
): Promise<{ fileName: string; contentType: string; data: Buffer } | null> {
  const row = await requirePeriod(db, context, periodId);
  const result = await db.query<{ file_name: string; content_type: string; data: Buffer }>(
    'SELECT file_name, content_type, data FROM utility_payment_receipts WHERE period_id = $1',
    [row.id],
  );
  const receipt = result.rows[0];
  return receipt ? { fileName: receipt.file_name, contentType: receipt.content_type, data: receipt.data } : null;
}
