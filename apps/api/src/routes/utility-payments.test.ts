import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UtilityPaymentPeriod, UtilityPaymentsOverview, UserNotification } from '@maxtown/shared';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { runUtilityPaymentMaintenance } from '../utility-payments/maintenance.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

describe.skipIf(!databaseUrl)('Платежи ЖКУ', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let apartmentId: string;
  const tokens: Record<string, string> = {};

  async function person(key: string, role: 'resident' | 'admin' | 'management-company', apartment: string | null): Promise<void> {
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [String(80_000 + Object.keys(tokens).length), `Имя ${key}`],
    );
    await pool.query(
      `INSERT INTO memberships (house_id, apartment_id, apartment_household_id, resident_id, role)
       VALUES ($1, $2, (SELECT id FROM apartment_households WHERE apartment_id = $2 AND ended_at IS NULL), $3, $4)`,
      [houseId, apartment, resident.rows[0]!.id, role],
    );
    tokens[key] = (await createSession(pool, resident.rows[0]!.id)).token;
  }

  const auth = (key: string) => ({ authorization: `Bearer ${tokens[key]}` });
  const base = () => `/api/houses/${houseId}/utility-payments`;

  beforeEach(async () => {
    for (const key of Object.keys(tokens)) delete tokens[key];
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Сроков, 1', 'Казань') RETURNING id")).rows[0]!.id;
    apartmentId = (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, '42'])).rows[0]!.id;
    const otherApartment = (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, '43'])).rows[0]!.id;
    await pool.query(
      `INSERT INTO apartment_households (house_id, apartment_id) VALUES ($1, $2), ($1, $3)`,
      [houseId, apartmentId, otherApartment],
    );
    await person('resident', 'resident', apartmentId);
    await person('same', 'resident', apartmentId);
    await person('admin', 'admin', apartmentId);
    await person('other', 'resident', otherApartment);
    await person('uk', 'management-company', null);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  async function createTemplate() {
    const response = await app.inject({
      method: 'POST', url: `${base()}/templates`, headers: auth('resident'),
      payload: { category: 'electricity', title: 'Электричество', dueDay: 31, startsOn: '2026-09-01' },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ template: { id: string; version: number } }>().template;
  }

  it('keeps schedules private to active members of one Apartment', async () => {
    await createTemplate();
    for (const key of ['resident', 'same', 'admin']) {
      const response = await app.inject({ method: 'GET', url: base(), headers: auth(key) });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<UtilityPaymentsOverview>().templates).toHaveLength(1);
    }
    expect((await app.inject({ method: 'GET', url: base(), headers: auth('other') })).json<UtilityPaymentsOverview>().templates).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: base(), headers: auth('uk') })).statusCode).toBe(403);
  });

  it('shares paid state and receipt, audits the actor, and supports correction', async () => {
    await createTemplate();
    const overview = (await app.inject({ method: 'GET', url: base(), headers: auth('resident') })).json<UtilityPaymentsOverview>();
    const period = overview.periods[0]!;
    const paid = await app.inject({ method: 'POST', url: `${base()}/periods/${period.id}/pay`, headers: auth('same'), payload: { version: period.version } });
    expect(paid.statusCode, paid.body).toBe(200);
    const paidPeriod = paid.json<{ period: UtilityPaymentPeriod }>().period;
    expect(paidPeriod.state).toBe('paid');

    const receipt = await app.inject({
      method: 'PUT', url: `${base()}/periods/${period.id}/receipt`,
      headers: { ...auth('same'), 'content-type': 'image/jpeg', 'x-file-name': encodeURIComponent('чек.jpg') }, payload: jpeg,
    });
    expect(receipt.statusCode, receipt.body).toBe(200);
    const withReceipt = receipt.json<{ period: UtilityPaymentPeriod }>().period;
    expect(withReceipt.receipt).toMatchObject({ fileName: 'чек.jpg', contentType: 'image/jpeg', uploadedBy: 'Имя same' });
    expect((await app.inject({ method: 'GET', url: withReceipt.receipt!.url, headers: auth('other') })).statusCode).toBe(404);

    const details = (await app.inject({ method: 'GET', url: `${base()}/periods/${period.id}`, headers: auth('admin') })).json<{ period: UtilityPaymentPeriod }>().period;
    expect(details.events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'paid', actorName: 'Имя same' })]));
    const corrected = await app.inject({ method: 'POST', url: `${base()}/periods/${period.id}/unpay`, headers: auth('admin'), payload: { version: withReceipt.version } });
    expect(corrected.json<{ period: UtilityPaymentPeriod }>().period).toMatchObject({ paidAt: null, receipt: null });
  });

  it('creates each reminder once for every active Apartment member', async () => {
    await createTemplate();
    const overview = (await app.inject({ method: 'GET', url: base(), headers: auth('resident') })).json<UtilityPaymentsOverview>();
    const period = overview.periods[0]!;
    await pool.query("UPDATE utility_payment_periods SET due_on = '2026-10-10', created_at = '2026-10-01T08:00:00Z' WHERE id = $1", [period.id]);
    await runUtilityPaymentMaintenance(pool, new Date('2026-10-07T06:00:00Z'));
    await runUtilityPaymentMaintenance(pool, new Date('2026-10-07T07:00:00Z'));
    const rows = await pool.query("SELECT resident_id FROM in_app_notifications WHERE utility_payment_period_id = $1 AND utility_payment_reminder_type = 'three-days'", [period.id]);
    expect(rows.rowCount).toBe(3);
    const notifications = (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth('resident') })).json<{ notifications: UserNotification[] }>().notifications;
    expect(notifications).toContainEqual(expect.objectContaining({ kind: 'utility-payment', utilityPaymentPeriodId: period.id }));
    expect((await pool.query('SELECT id FROM max_direct_message_outbox WHERE utility_payment_period_id = $1', [period.id])).rowCount).toBe(3);
  });
});
