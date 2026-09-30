import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('ограниченный доступ к адресу Квартиры', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  const people: Record<string, { residentId: string; token: string }> = {};

  async function person(key: string, withMembership = true): Promise<void> {
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [String(930_000 + Object.keys(people).length), `Жилец ${key}`],
    );
    const residentId = resident.rows[0]!.id;
    if (withMembership) await pool.query(
      "INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'resident')",
      [houseId, residentId],
    );
    people[key] = { residentId, token: (await createSession(pool, residentId)).token };
  }

  const headers = (key: string) => ({ authorization: `Bearer ${people[key]!.token}` });
  const base = () => `/api/houses/${houseId}/apartment-info-access`;

  beforeEach(async () => {
    for (const key of Object.keys(people)) delete people[key];
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>(
      "INSERT INTO houses (address, locality) VALUES ('ул. Ограниченная, 1', 'Казань') RETURNING id",
    )).rows[0]!.id;
    await person('owner');
    await person('recipient');
    await person('outsider', false);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  it('выдаёт только адрес и номер, не меняя членство, и отзывает доступ отдельно от Приглашения', async () => {
    const joined = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-access`, headers: headers('owner'),
      payload: { apartmentNumber: '42', floor: 7 },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const apartmentId = joined.json<{ state: { apartment: { id: string } } }>().state.apartment.id;
    const issued = await app.inject({
      method: 'POST', url: `${base()}/invitations`, headers: headers('owner'), payload: { apartmentId },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const code = issued.json<{ code: string; expiresAt: string }>().code;
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(issued.json<{ expiresAt: string }>().expiresAt).toBeTruthy();

    expect((await app.inject({ method: 'GET', url: `/api/apartment-info-invitations/${code}`, headers: headers('outsider') })).json())
      .toMatchObject({ invitation: { status: 'not-house-member' } });
    expect((await app.inject({ method: 'GET', url: `/api/apartment-info-invitations/${code}`, headers: headers('recipient') })).json())
      .toMatchObject({ invitation: { status: 'valid', houseAddress: 'ул. Ограниченная, 1', apartment: '42' } });

    const redeemed = await app.inject({ method: 'POST', url: `/api/apartment-info-invitations/${code}/redeem`, headers: headers('recipient') });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect((await pool.query<{ apartment_id: string | null; apartment_household_id: string | null }>(
      'SELECT apartment_id, apartment_household_id FROM memberships WHERE resident_id = $1 AND ended_at IS NULL',
      [people.recipient!.residentId],
    )).rows[0]).toEqual({ apartment_id: null, apartment_household_id: null });
    expect((await app.inject({ method: 'POST', url: `/api/apartment-info-invitations/${code}/redeem`, headers: headers('recipient') })).statusCode).toBe(200);

    const grants = (await app.inject({ method: 'GET', url: base(), headers: headers('owner') })).json<{ grants: { id: string; residentName: string }[] }>();
    expect(grants.grants).toMatchObject([{ residentName: 'Жилец recipient', apartment: '42' }]);
    expect((await app.inject({ method: 'DELETE', url: `${base()}/${grants.grants[0]!.id}`, headers: headers('owner') })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `${base()}/invitations/${code}`, headers: headers('owner') })).statusCode).toBe(404);
  });

  it('отзывает неиспользованную ссылку и запрещает её последующее принятие', async () => {
    const joined = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/apartment-access`, headers: headers('owner'),
      payload: { apartmentNumber: '5', floor: 2 },
    });
    const apartmentId = joined.json<{ state: { apartment: { id: string } } }>().state.apartment.id;
    const issued = await app.inject({ method: 'POST', url: `${base()}/invitations`, headers: headers('owner'), payload: { apartmentId } });
    const code = issued.json<{ code: string }>().code;
    expect((await app.inject({ method: 'DELETE', url: `${base()}/invitations/${code}`, headers: headers('owner') })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/apartment-info-invitations/${code}`, headers: headers('recipient') })).json())
      .toMatchObject({ invitation: { status: 'revoked' } });
    expect((await app.inject({ method: 'POST', url: `/api/apartment-info-invitations/${code}/redeem`, headers: headers('recipient') })).statusCode).toBe(404);
  });
});
