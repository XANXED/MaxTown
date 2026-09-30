import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApartmentAccessState, Meter, ReadingsWindow, UtilityPaymentsOverview } from '@maxtown/shared';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { closeHouseholdIfVacant } from '../apartment-access/store.ts';
import { inTransaction } from '../db/transaction.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('защищённая привязка к Квартире', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  const people: Record<string, { residentId: string; token: string }> = {};

  async function person(key: string, withMembership = true): Promise<void> {
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [String(910_000 + Object.keys(people).length), `Жилец ${key}`],
    );
    if (withMembership) {
      await pool.query(
        "INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'resident')",
        [houseId, resident.rows[0]!.id],
      );
    }
    people[key] = { residentId: resident.rows[0]!.id, token: (await createSession(pool, resident.rows[0]!.id)).token };
  }

  const headers = (key: string) => ({ authorization: `Bearer ${people[key]!.token}` });
  const accessUrl = () => `/api/houses/${houseId}/apartment-access`;

  beforeEach(async () => {
    for (const key of Object.keys(people)) delete people[key];
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>(
      "INSERT INTO houses (address, locality) VALUES ('ул. Домохозяйств, 1', 'Казань') RETURNING id",
    )).rows[0]!.id;
    await person('first');
    await person('second');
    await person('other');
    await person('outsider', false);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  it('занимает пустую Квартиру сразу, а второго участника переводит в ожидание', async () => {
    const joined = await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('first'),
      payload: { apartmentNumber: '42а', floor: 7 },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    expect(joined.json()).toMatchObject({ status: 'joined', state: { apartment: { number: '42А', floor: 7, entrance: null } } });

    const pending = await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('second'),
      payload: { apartmentNumber: '42А', floor: 7 },
    });
    expect(pending.statusCode, pending.body).toBe(202);
    expect(pending.json()).toMatchObject({ status: 'pending', request: { requesterName: 'Жилец second' } });
    const requestId = pending.json<{ request: { id: string } }>().request.id;

    await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('other'),
      payload: { apartmentNumber: '43', floor: 7 },
    });
    const denied = await app.inject({
      method: 'POST', url: `${accessUrl()}/requests/${requestId}/decision`, headers: headers('other'),
      payload: { decision: 'approve' },
    });
    expect(denied.statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('outsider'),
      payload: { apartmentNumber: '44', floor: 8 },
    })).statusCode).toBe(404);

    const approved = await app.inject({
      method: 'POST', url: `${accessUrl()}/requests/${requestId}/decision`, headers: headers('first'),
      payload: { decision: 'approve' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const state = (await app.inject({ method: 'GET', url: accessUrl(), headers: headers('second') })).json<ApartmentAccessState>();
    expect(state).toMatchObject({ status: 'joined', apartment: { number: '42А' } });
  });

  it('сериализует одновременное занятие пустой Квартиры', async () => {
    const replies = await Promise.all(['first', 'second'].map((key) => app.inject({
      method: 'POST', url: accessUrl(), headers: headers(key),
      payload: { apartmentNumber: '77', floor: 12, entrance: 3 },
    })));
    expect(replies.map(({ statusCode }) => statusCode).sort()).toEqual([201, 202]);
    expect((await pool.query("SELECT id FROM join_requests WHERE status = 'pending'")).rowCount).toBe(1);
    expect((await pool.query('SELECT id FROM apartment_households WHERE ended_at IS NULL')).rowCount).toBe(1);
  });

  it('запрещает самостоятельный переезд и повторное решение', async () => {
    await app.inject({ method: 'POST', url: accessUrl(), headers: headers('first'), payload: { apartmentNumber: '1', floor: 2, entrance: 1 } });
    const pending = await app.inject({ method: 'POST', url: accessUrl(), headers: headers('second'), payload: { apartmentNumber: '1', floor: 2, entrance: 1 } });
    const requestId = pending.json<{ request: { id: string } }>().request.id;
    expect((await app.inject({
      method: 'POST', url: `${accessUrl()}/requests/${requestId}/decision`, headers: headers('first'), payload: { decision: 'reject' },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `${accessUrl()}/requests/${requestId}/decision`, headers: headers('first'), payload: { decision: 'approve' },
    })).statusCode).toBe(409);
    const move = await app.inject({ method: 'POST', url: accessUrl(), headers: headers('first'), payload: { apartmentNumber: '2', floor: 2 } });
    expect(move.statusCode).toBe(409);
    expect(move.json()).toEqual({ error: 'apartment_change_forbidden' });
  });

  it('привязывает Приглашение к текущему Домохозяйству и требует участие в Домовом чате', async () => {
    await app.inject({ method: 'POST', url: accessUrl(), headers: headers('first'), payload: { apartmentNumber: '9', floor: 3 } });
    const issued = await app.inject({ method: 'POST', url: `${accessUrl()}/invitations`, headers: headers('first') });
    expect(issued.statusCode, issued.body).toBe(201);
    const code = issued.json<{ code: string }>().code;
    expect((await app.inject({ method: 'POST', url: `/api/invitations/${code}/redeem`, headers: headers('outsider') })).statusCode).toBe(404);
    const redeemed = await app.inject({ method: 'POST', url: `/api/invitations/${code}/redeem`, headers: headers('second') });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/invitations/${code}/redeem`, headers: headers('second') })).statusCode).toBe(200);
  });

  it('разрешает только одно конкурентное решение по Запросу', async () => {
    await app.inject({ method: 'POST', url: accessUrl(), headers: headers('first'), payload: { apartmentNumber: '15', floor: 4 } });
    const invite = await app.inject({ method: 'POST', url: `${accessUrl()}/invitations`, headers: headers('first') });
    await app.inject({ method: 'POST', url: `/api/invitations/${invite.json<{ code: string }>().code}/redeem`, headers: headers('second') });
    const pending = await app.inject({ method: 'POST', url: accessUrl(), headers: headers('other'), payload: { apartmentNumber: '15', floor: 4 } });
    const requestId = pending.json<{ request: { id: string } }>().request.id;
    const decisions = await Promise.all(['first', 'second'].map((key) => app.inject({
      method: 'POST', url: `${accessUrl()}/requests/${requestId}/decision`, headers: headers(key), payload: { decision: 'approve' },
    })));
    expect(decisions.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
  });

  it('новый состав наследует Приборы и Показания, но не платежные данные прежнего Домохозяйства', async () => {
    await app.inject({ method: 'POST', url: accessUrl(), headers: headers('first'), payload: { apartmentNumber: '21', floor: 5 } });
    const paymentsUrl = `/api/houses/${houseId}/utility-payments`;
    const template = await app.inject({
      method: 'POST', url: `${paymentsUrl}/templates`, headers: headers('first'),
      payload: { category: 'water', title: 'Вода прежнего состава', dueDay: 25, startsOn: '2026-09-01' },
    });
    expect(template.statusCode, template.body).toBe(201);
    const meterResponse = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/meters`, headers: headers('first'),
      payload: { kind: 'cold-water', title: 'Холодная вода', serial: 'OLD-21', decimals: 3 },
    });
    const meter = meterResponse.json<{ meter: Meter }>().meter;
    const oldInvite = await app.inject({ method: 'POST', url: `${accessUrl()}/invitations`, headers: headers('first') });
    const oldInviteCode = oldInvite.json<{ code: string }>().code;
    const oldPending = await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('other'),
      payload: { apartmentNumber: '21', floor: 5 },
    });
    expect(oldPending.statusCode).toBe(202);
    const oldMembership = await pool.query<{ id: string; apartment_id: string; apartment_household_id: string }>(
      `SELECT id, apartment_id, apartment_household_id FROM memberships
        WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL`,
      [people.first!.residentId, houseId],
    );
    await pool.query(
      `INSERT INTO utility_meter_readings
         (meter_id, house_id, apartment_id, reading_month, value, submitted_by_membership_id)
       VALUES ($1, $2, $3, '2026-09-01', 127.5, $4)`,
      [meter.id, houseId, oldMembership.rows[0]!.apartment_id, oldMembership.rows[0]!.id],
    );

    await inTransaction(pool, async (client) => {
      await client.query('UPDATE memberships SET ended_at = now() WHERE id = $1', [oldMembership.rows[0]!.id]);
      await closeHouseholdIfVacant(client, oldMembership.rows[0]!.apartment_household_id);
    });
    expect((await app.inject({ method: 'GET', url: `/api/invitations/${oldInviteCode}`, headers: headers('other') })).json())
      .toMatchObject({ invitation: { status: 'revoked' } });
    expect((await app.inject({ method: 'GET', url: accessUrl(), headers: headers('other') })).json())
      .toMatchObject({ status: 'unbound' });
    await person('new');
    const claimed = await app.inject({
      method: 'POST', url: accessUrl(), headers: headers('new'),
      payload: { apartmentNumber: '21', floor: 5 },
    });
    expect(claimed.statusCode, claimed.body).toBe(201);

    const payments = (await app.inject({ method: 'GET', url: paymentsUrl, headers: headers('new') })).json<UtilityPaymentsOverview>();
    expect(payments.templates).toEqual([]);
    expect(payments.periods).toEqual([]);
    const readings = (await app.inject({
      method: 'GET', url: `/api/houses/${houseId}/readings`, headers: headers('new'),
    })).json<ReadingsWindow>();
    expect(readings.meters).toHaveLength(1);
    expect(readings.meters[0]).toMatchObject({ id: meter.id, current: { value: 127.5 } });
  });
});
