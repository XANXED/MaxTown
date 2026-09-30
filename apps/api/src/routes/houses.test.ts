import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('регистрация Дома', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let residentToken: string;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const resident = await pool.query<{ id: string }>(
      "INSERT INTO residents (max_user_id, display_name) VALUES ('house-registration-resident', 'Тестовый Жилец') RETURNING id",
    );
    residentToken = (await createSession(pool, resident.rows[0]!.id)).token;
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app.close(); });

  it('создаёт авторизованную заявку на Дом и возвращает её заявителю', async () => {
    const headers = { authorization: `Bearer ${residentToken}` };
    const response = await app.inject({
      method: 'POST', url: '/api/houses/registrations', headers,
      payload: { address: 'ул. Новая, 7', locality: 'Казань', apartmentNumber: '34А' },
    });
    expect(response.statusCode).toBe(201);
    const mine = await app.inject({ method: 'GET', url: '/api/houses/registrations/mine', headers });
    expect(mine.json()).toMatchObject({
      registration: { address: 'ул. Новая, 7', status: 'pending', headman: { apartment: '34А' } },
    });
  });
});
