import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('house service directory', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let otherHouseId: string;
  let residentToken: string;
  let headmanToken: string;
  let foreignToken: string;
  let apartmentNumber = 0;

  async function person(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>('INSERT INTO residents (max_user_id, display_name) VALUES ($1, $1) RETURNING id', [key]);
    const session = await createSession(pool, result.rows[0]!.id);
    return { id: result.rows[0]!.id, token: session.token };
  }

  async function addMember(targetHouseId: string, key: string, role: 'resident' | 'admin'): Promise<string> {
    const member = await person(key);
    apartmentNumber += 1;
    const apartment = await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [targetHouseId, String(apartmentNumber)]);
    await pool.query('INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)', [targetHouseId, apartment.rows[0]!.id, member.id, role]);
    return member.token;
  }

  beforeEach(async () => {
    apartmentNumber = 0;
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const houses = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Тарифная, 1', 'Казань'), ('ул. Другая, 2', 'Казань') RETURNING id");
    houseId = houses.rows[0]!.id;
    otherHouseId = houses.rows[1]!.id;
    residentToken = await addMember(houseId!, 'directory-resident', 'resident');
    headmanToken = await addMember(houseId!, 'directory-headman', 'admin');
    foreignToken = await addMember(otherHouseId!, 'directory-foreign', 'resident');
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('lets any active member read only their house catalog and limits edits to House leaders', async () => {
    const token = { authorization: `Bearer ${headmanToken}` };
    const payload = {
      category: 'internet', provider: 'ДомСвязь', title: 'Домашний интернет', state: 'available',
      contacts: { phone: '+7 843 123-45-67', link: 'https://example.org', details: 'Поддержка ежедневно' },
      note: 'Подключение через заявку на сайте',
      tariffs: [{ amount: '650.00', currency: 'RUB', billingPeriod: 'месяц', conditions: 'Первые 3 месяца', startsOn: '2026-01-01', endsOn: null, source: 'https://example.org/tariffs', checkedOn: '2026-09-01' }],
    };
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/services`, headers: token, payload });
    expect(created.statusCode).toBe(201);
    const serviceId = created.json<{ service: { id: string } }>().service.id;
    const member = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/services`, headers: { authorization: `Bearer ${residentToken}` } });
    expect(member.statusCode).toBe(200);
    expect(member.json<{ services: Array<{ provider: string; tariffs: Array<{ source: string; checkedOn: string }> }> }>().services[0]).toMatchObject({ provider: 'ДомСвязь', tariffs: [{ source: 'https://example.org/tariffs', checkedOn: '2026-09-01' }] });
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/services`, headers: { authorization: `Bearer ${foreignToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/services/${serviceId}`, headers: { authorization: `Bearer ${residentToken}` }, payload })).statusCode).toBe(403);
  });

  it('rejects missing tariff provenance, malformed dates, and negative prices', async () => {
    const headers = { authorization: `Bearer ${headmanToken}` };
    const base = { category: 'internet', provider: 'ДомСвязь', title: 'Интернет', state: 'available', contacts: {}, tariffs: [] };
    for (const tariff of [
      { amount: '100', currency: 'RUB', billingPeriod: 'месяц', conditions: '', startsOn: '2026-01-01', source: '', checkedOn: '2026-01-01' },
      { amount: '-5', currency: 'RUB', billingPeriod: 'месяц', conditions: '', startsOn: '2026-01-01', source: 'сайт', checkedOn: '2026-01-01' },
      { amount: '100', currency: 'RUB', billingPeriod: 'месяц', conditions: '', startsOn: '2026-02-30', source: 'сайт', checkedOn: '2026-01-01' },
    ]) {
      const result = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/services`, headers, payload: { ...base, tariffs: [tariff] } });
      expect(result.statusCode).toBe(400);
    }
  });
});
