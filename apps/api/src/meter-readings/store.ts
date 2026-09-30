import type { Pool, PoolClient } from 'pg';
import type { Meter, MeterInput, MeterKind, ReadingsInput, ReadingsWindow } from '@maxtown/shared';
import { dueDateForMonth, houseDate, monthStart } from '../utility-payments/model.ts';

type Db = Pool | PoolClient;

export type MeterReadingsContext = {
  houseId: string;
  apartmentId: string;
  apartmentNumber: string;
  membershipId: string;
};

export class MeterReadingsProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type MeterRow = {
  id: string;
  house_id: string;
  apartment_id: string;
  kind: MeterKind;
  title: string;
  serial: string | null;
  decimals: number;
  version: number;
  current_value: string | null;
  current_at: Date | null;
  previous_value: string | null;
  previous_month: string | null;
};

const units: Record<MeterKind, string> = {
  'cold-water': 'м³',
  'hot-water': 'м³',
  'electricity-day': 'кВт·ч',
  'electricity-night': 'кВт·ч',
  heat: 'Гкал',
};

function normalizedMeter(input: MeterInput): Omit<MeterInput, 'version'> {
  const title = input.title.trim();
  const serial = input.serial?.trim() || undefined;
  if (!title || title.length > 120) throw new MeterReadingsProblem(400, 'meter_invalid');
  if (serial && serial.length > 80) throw new MeterReadingsProblem(400, 'meter_invalid');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 3) {
    throw new MeterReadingsProblem(400, 'meter_invalid');
  }
  return { kind: input.kind, title, ...(serial ? { serial } : {}), decimals: input.decimals };
}

function toMeter(row: MeterRow): Meter {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    unit: units[row.kind],
    ...(row.serial ? { serial: row.serial } : {}),
    decimals: row.decimals,
    version: row.version,
    ...(row.previous_value !== null && row.previous_month
      ? { previous: { value: Number(row.previous_value), at: row.previous_month } }
      : {}),
    ...(row.current_value !== null && row.current_at
      ? { current: { value: Number(row.current_value), at: row.current_at.toISOString() } }
      : {}),
  };
}

async function meterRows(db: Db, context: MeterReadingsContext, billingMonth: string): Promise<MeterRow[]> {
  const result = await db.query<MeterRow>(
    `SELECT meter.id, meter.house_id, meter.apartment_id, meter.kind, meter.title, meter.serial,
            meter.decimals, meter.version,
            current_reading.value::text AS current_value, current_reading.submitted_at AS current_at,
            previous_reading.value::text AS previous_value, previous_reading.reading_month::text AS previous_month
       FROM utility_meters meter
       LEFT JOIN LATERAL (
         SELECT value, submitted_at FROM utility_meter_readings
          WHERE meter_id = meter.id AND reading_month = $3::date
          LIMIT 1
       ) current_reading ON true
       LEFT JOIN LATERAL (
         SELECT value, reading_month FROM utility_meter_readings
          WHERE meter_id = meter.id AND reading_month < $3::date
          ORDER BY reading_month DESC LIMIT 1
       ) previous_reading ON true
      WHERE meter.house_id = $1 AND meter.apartment_id = $2 AND meter.archived_at IS NULL
      ORDER BY meter.created_at, meter.id`,
    [context.houseId, context.apartmentId, billingMonth],
  );
  return result.rows;
}

export async function listMeterReadings(
  db: Db,
  context: MeterReadingsContext,
  now = new Date(),
): Promise<ReadingsWindow> {
  const today = houseDate(now);
  const billingMonth = monthStart(today);
  return {
    from: billingMonth,
    to: dueDateForMonth(billingMonth, 31),
    apartment: `Квартира ${context.apartmentNumber}`,
    meters: (await meterRows(db, context, billingMonth)).map(toMeter),
  };
}

type BasicMeterRow = Omit<MeterRow, 'current_value' | 'current_at' | 'previous_value' | 'previous_month'>;

function bareMeter(row: BasicMeterRow): Meter {
  return toMeter({ ...row, current_value: null, current_at: null, previous_value: null, previous_month: null });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function createMeter(
  db: Db,
  context: MeterReadingsContext,
  input: MeterInput,
): Promise<Meter> {
  const value = normalizedMeter(input);
  try {
    const result = await db.query<BasicMeterRow>(
      `INSERT INTO utility_meters
         (house_id, apartment_id, kind, title, serial, decimals, created_by_membership_id, updated_by_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING id, house_id, apartment_id, kind, title, serial, decimals, version`,
      [context.houseId, context.apartmentId, value.kind, value.title, value.serial ?? null, value.decimals, context.membershipId],
    );
    return bareMeter(result.rows[0]!);
  } catch (error) {
    if (isUniqueViolation(error)) throw new MeterReadingsProblem(409, 'meter_already_exists');
    throw error;
  }
}

export async function updateMeter(
  db: Db,
  context: MeterReadingsContext,
  meterId: string,
  input: MeterInput,
): Promise<Meter> {
  const value = normalizedMeter(input);
  if (!input.version || !Number.isInteger(input.version)) throw new MeterReadingsProblem(400, 'meter_version_required');
  try {
    const result = await db.query<BasicMeterRow>(
      `UPDATE utility_meters
          SET kind = $4, title = $5, serial = $6, decimals = $7,
              updated_by_membership_id = $8, updated_at = now(), version = version + 1
        WHERE id = $1 AND house_id = $2 AND apartment_id = $3 AND archived_at IS NULL AND version = $9
        RETURNING id, house_id, apartment_id, kind, title, serial, decimals, version`,
      [meterId, context.houseId, context.apartmentId, value.kind, value.title, value.serial ?? null,
        value.decimals, context.membershipId, input.version],
    );
    if (result.rows[0]) return bareMeter(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new MeterReadingsProblem(409, 'meter_already_exists');
    throw error;
  }
  const exists = await db.query(
    'SELECT 1 FROM utility_meters WHERE id = $1 AND house_id = $2 AND apartment_id = $3 AND archived_at IS NULL',
    [meterId, context.houseId, context.apartmentId],
  );
  throw new MeterReadingsProblem(exists.rowCount ? 409 : 404, exists.rowCount ? 'meter_version_conflict' : 'meter_not_found');
}

export async function archiveMeter(
  db: Db,
  context: MeterReadingsContext,
  meterId: string,
  version: number,
): Promise<void> {
  const result = await db.query(
    `UPDATE utility_meters
        SET archived_at = now(), updated_by_membership_id = $4, updated_at = now(), version = version + 1
      WHERE id = $1 AND house_id = $2 AND apartment_id = $3 AND archived_at IS NULL AND version = $5`,
    [meterId, context.houseId, context.apartmentId, context.membershipId, version],
  );
  if (result.rowCount) return;
  const exists = await db.query(
    'SELECT 1 FROM utility_meters WHERE id = $1 AND house_id = $2 AND apartment_id = $3 AND archived_at IS NULL',
    [meterId, context.houseId, context.apartmentId],
  );
  throw new MeterReadingsProblem(exists.rowCount ? 409 : 404, exists.rowCount ? 'meter_version_conflict' : 'meter_not_found');
}

function hasAllowedPrecision(value: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-7;
}

export async function saveMeterReadings(
  db: Db,
  context: MeterReadingsContext,
  input: ReadingsInput,
  now = new Date(),
): Promise<ReadingsWindow> {
  if (input.readings.length === 0) throw new MeterReadingsProblem(400, 'readings_empty');
  const ids = input.readings.map(({ meterId }) => meterId);
  if (new Set(ids).size !== ids.length) throw new MeterReadingsProblem(400, 'readings_duplicate_meter');
  const billingMonth = monthStart(houseDate(now));
  // Одинаковый порядок блокировок не даёт двум участникам Квартиры устроить
  // взаимную блокировку, если они одновременно сохраняют несколько приборов.
  const readings = input.readings.toSorted((left, right) => left.meterId.localeCompare(right.meterId));

  for (const reading of readings) {
    const meterResult = await db.query<{ id: string; decimals: number }>(
      `SELECT id, decimals FROM utility_meters
        WHERE id = $1 AND house_id = $2 AND apartment_id = $3 AND archived_at IS NULL
        FOR UPDATE`,
      [reading.meterId, context.houseId, context.apartmentId],
    );
    const meter = meterResult.rows[0];
    if (!meter) throw new MeterReadingsProblem(404, 'meter_not_found');
    if (!Number.isFinite(reading.value) || reading.value < 0 || reading.value >= 1_000_000_000_000_000
      || !hasAllowedPrecision(reading.value, meter.decimals)) {
      throw new MeterReadingsProblem(400, 'reading_invalid');
    }
    const previous = await db.query<{ value: string }>(
      `SELECT value::text FROM utility_meter_readings
        WHERE meter_id = $1 AND reading_month < $2::date
        ORDER BY reading_month DESC LIMIT 1`,
      [meter.id, billingMonth],
    );
    if (previous.rows[0] && reading.value < Number(previous.rows[0].value)) {
      throw new MeterReadingsProblem(409, 'reading_less_than_previous');
    }
    await db.query(
      `INSERT INTO utility_meter_readings
         (meter_id, house_id, apartment_id, reading_month, value, submitted_by_membership_id, submitted_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)
       ON CONFLICT (meter_id, reading_month) DO UPDATE
         SET value = EXCLUDED.value,
             submitted_by_membership_id = EXCLUDED.submitted_by_membership_id,
             submitted_at = EXCLUDED.submitted_at,
             version = utility_meter_readings.version + 1`,
      [meter.id, context.houseId, context.apartmentId, billingMonth, reading.value, context.membershipId, now],
    );
  }
  return listMeterReadings(db, context, now);
}
