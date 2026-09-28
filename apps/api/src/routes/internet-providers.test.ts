import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('internet providers in a House', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let otherHouseId: string;
  let residentToken: string;
  let secondResidentToken: string;
  let headmanToken: string;
  let responsibleToken: string;
  let conciergeToken: string;
  let foreignToken: string;
  let apartmentNumber = 0;

  async function person(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>('INSERT INTO residents (vk_user_id, display_name) VALUES ($1, $1) RETURNING id', [key]);
    const session = await createSession(pool, result.rows[0]!.id);
    return { id: result.rows[0]!.id, token: session.token };
  }

  async function addMember(targetHouseId: string, key: string, role: 'resident' | 'headman' | 'responsible' | 'concierge'): Promise<string> {
    const member = await person(key);
    const apartmentId = role === 'concierge' ? null : await pool.query<{ id: string }>(
      'INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id',
      [targetHouseId, String(++apartmentNumber)],
    ).then(({ rows }) => rows[0]!.id);
    await pool.query(
      'INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)',
      [targetHouseId, apartmentId, member.id, role],
    );
    return member.token;
  }

  const provider = {
    name: 'ДомСвязь',
    availability: 'available',
    phone: '+7 843 123-45-67',
    link: 'https://example.org/connect',
    note: 'Финальную техническую возможность подтвердит Поставщик.',
    tariffs: [{
      name: 'Дом 500', speedMbps: 500, monthlyPrice: '750.00', promoPrice: '500.00', promoMonths: 3,
      technology: 'fttb', hasTv: false, conditions: 'Роутер оплачивается отдельно',
      source: 'https://example.org/tariffs', checkedOn: '2026-09-20',
    }],
  } as const;

  beforeEach(async () => {
    apartmentNumber = 0;
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const houses = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Сетевая, 1', 'Казань'), ('ул. Другая, 2', 'Казань') RETURNING id");
    houseId = houses.rows[0]!.id;
    otherHouseId = houses.rows[1]!.id;
    residentToken = await addMember(houseId, 'internet-resident', 'resident');
    secondResidentToken = await addMember(houseId, 'internet-second-resident', 'resident');
    headmanToken = await addMember(houseId, 'internet-headman', 'headman');
    responsibleToken = await addMember(houseId, 'internet-responsible', 'responsible');
    conciergeToken = await addMember(houseId, 'internet-concierge', 'concierge');
    foreignToken = await addMember(otherHouseId, 'internet-foreign', 'resident');
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('lets House leaders publish sourced tariffs and active members read only their House', async () => {
    const token = { authorization: `Bearer ${headmanToken}` };
    const created = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/internet-providers`,
      headers: token, payload: provider,
    });
    expect(created.statusCode).toBe(201);
    const serviceId = created.json<{ provider: { id: string } }>().provider.id;
    expect(created.json()).toMatchObject({ provider: { name: 'ДомСвязь', source: 'manual', manualOverride: true, rating: { average: null, count: 0, myScore: null }, tariffs: [{ speedMbps: 500, monthlyPrice: '750.00' }] } });

    const resident = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${residentToken}` } });
    expect(resident.statusCode).toBe(200);
    expect(resident.json()).toMatchObject({ providers: [{ name: 'ДомСвязь', availability: 'available', tariffs: [{ name: 'Дом 500', source: 'https://example.org/tariffs' }] }] });
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${foreignToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${residentToken}` }, payload: provider })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${responsibleToken}` }, payload: provider })).statusCode).toBe(403);

    const updated = await app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/internet-providers/${serviceId}`,
      headers: token, payload: { ...provider, name: 'ДомСвязь Казань', availability: 'limited' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ provider: { name: 'ДомСвязь Казань', availability: 'limited' } });
    expect(await pool.query("SELECT event_type FROM audit_events WHERE house_id = $1 AND event_type LIKE 'internet_provider.%' ORDER BY occurred_at", [houseId]).then(({ rows }) => rows)).toEqual([
      { event_type: 'internet_provider.created' }, { event_type: 'internet_provider.updated' },
    ]);
    expect((await app.inject({ method: 'DELETE', url: `/api/houses/${houseId}/internet-providers/${serviceId}`, headers: token })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${residentToken}` } })).json()).toEqual({ providers: [], importState: { status: 'not-configured', source: null, lastAttemptAt: null, lastSuccessAt: null, error: null } });
    const restored = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/internet-providers`, headers: token, payload: { ...provider, name: 'ДомСвязь Казань' } });
    expect(restored.statusCode).toBe(201);
    expect(restored.json()).toMatchObject({ provider: { id: serviceId, name: 'ДомСвязь Казань' } });
  });

  it('keeps one current rating per apartment member and aggregates only this House', async () => {
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${headmanToken}` }, payload: provider });
    const providerId = created.json<{ provider: { id: string } }>().provider.id;

    const rate = (token: string, score: number) => app.inject({
      method: 'PUT', url: `/api/houses/${houseId}/internet-providers/${providerId}/rating`,
      headers: { authorization: `Bearer ${token}` }, payload: { score },
    });
    expect((await rate(residentToken, 2)).statusCode).toBe(200);
    expect((await rate(secondResidentToken, 4)).statusCode).toBe(200);
    const changed = await rate(residentToken, 5);
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ rating: { average: 4.5, count: 2, myScore: 5 } });

    const formerMember = await pool.query<{ membership_id: string }>('SELECT membership_id FROM house_internet_provider_ratings WHERE service_id = $1 AND score = 5', [providerId]);
    await pool.query('UPDATE memberships SET ended_at = now() WHERE id = $1', [formerMember.rows[0]!.membership_id]);
    const activeView = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/internet-providers`, headers: { authorization: `Bearer ${secondResidentToken}` } });
    expect(activeView.json()).toMatchObject({ providers: [{ rating: { average: 4, count: 1, myScore: 4 } }] });

    expect((await rate(conciergeToken, 5)).statusCode).toBe(403);
    expect((await rate(secondResidentToken, 0)).statusCode).toBe(400);
    expect((await rate(foreignToken, 5)).statusCode).toBe(403);
    expect(await pool.query('SELECT score FROM house_internet_provider_ratings WHERE service_id = $1 ORDER BY score', [providerId]).then(({ rows }) => rows)).toEqual([{ score: 4 }, { score: 5 }]);
  });

  it('rejects unverifiable tariff data and unsafe links', async () => {
    const headers = { authorization: `Bearer ${headmanToken}` };
    const invalid = [
      { ...provider, link: 'http://example.org' },
      { ...provider, tariffs: [{ ...provider.tariffs[0], source: '' }] },
      { ...provider, tariffs: [{ ...provider.tariffs[0], speedMbps: 0 }] },
      { ...provider, tariffs: [{ ...provider.tariffs[0], promoPrice: '900.00' }] },
    ];
    for (const payload of invalid) {
      const response = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/internet-providers`, headers, payload });
      expect(response.statusCode, response.body).toBe(400);
    }
  });
});
