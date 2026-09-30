import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HouseEventDetails, HouseEventSummary, HouseStateResponse } from '@maxtown/shared';
import { buildApp } from '../app.ts';
import { createSession } from '../auth/sessions.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('Плановые отключения и Объявления', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  const tokens: Record<string, string> = {};

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Плановая, 1', 'Казань') RETURNING id")).rows[0]!.id;
    for (const [index, role] of (['resident', 'admin', 'management-company'] as const).entries()) {
      const resident = (await pool.query<{ id: string }>(
        'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
        [String(96_000 + index), `Имя ${role}`],
      )).rows[0]!;
      await pool.query('INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, $3)', [houseId, resident.id, role]);
      tokens[role] = (await createSession(pool, resident.id)).token;
    }
    app = await buildApp({ pool, env: { NODE_ENV: 'test', MAX_CHAT_NOTIFICATIONS: 'off' } });
  });

  afterEach(async () => { await app?.close(); });

  const auth = (role: string) => ({ authorization: `Bearer ${tokens[role]}` });
  const publicationsUrl = () => `/api/houses/${houseId}/events/publications`;

  it('lets УК and the House administrator publish events visible to all House members', async () => {
    const now = Date.now();
    const currentOutage = {
      kind: 'planned-outage', title: 'Отключение воды', description: 'Меняют задвижку на вводе',
      scope: 'Весь Дом', systems: ['Вода'],
      startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(),
      advice: ['Наберите воду заранее'],
    };
    expect((await app.inject({ method: 'POST', url: publicationsUrl(), headers: auth('resident'), payload: currentOutage })).statusCode).toBe(403);

    const published = await app.inject({ method: 'POST', url: publicationsUrl(), headers: auth('admin'), payload: currentOutage });
    expect(published.statusCode, published.body).toBe(201);
    const outage = published.json<{ event: HouseEventDetails }>().event;
    expect(outage).toMatchObject({ kind: 'planned-outage', systems: ['Вода'], author: { role: 'Администратор Дома' } });

    const announcement = await app.inject({
      method: 'POST', url: publicationsUrl(), headers: auth('management-company'),
      payload: {
        kind: 'announcement', title: 'Собрание во дворе', description: 'Обсудим благоустройство', systems: [],
        startsAt: new Date(now + 86_400_000).toISOString(),
      },
    });
    expect(announcement.statusCode, announcement.body).toBe(201);

    const list = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/events`, headers: auth('resident') });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ events: HouseEventSummary[] }>().events.map(({ kind }) => kind)).toEqual(['planned-outage', 'announcement']);

    const details = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/events/${outage.id}`, headers: auth('resident') });
    expect(details.json<{ event: HouseEventDetails }>().event.description).toBe('Меняют задвижку на вводе');

    const state = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/state`, headers: auth('resident') });
    const water = state.json<{ state: HouseStateResponse }>().state.systems.find(({ name }) => name === 'Вода');
    expect(water).toMatchObject({ status: 'planned-outage', eventId: outage.id });

    expect((await app.inject({ method: 'DELETE', url: `/api/houses/${houseId}/events/${outage.id}/publication`, headers: auth('resident') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/houses/${houseId}/events/${outage.id}/publication`, headers: auth('admin') })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/events/${outage.id}`, headers: auth('resident') })).statusCode).toBe(404);
    const audit = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM audit_events WHERE house_id = $1 AND event_type LIKE 'house_event.%' ORDER BY occurred_at, id",
      [houseId],
    );
    expect(audit.rows.map(({ event_type }) => event_type)).toEqual([
      'house_event.planned-outage.published',
      'house_event.announcement.published',
      'house_event.planned-outage.cancelled',
    ]);
  });

  it('rejects an invalid time range and a planned outage without a System', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const invalid = await app.inject({
      method: 'POST', url: publicationsUrl(), headers: auth('admin'),
      payload: { kind: 'planned-outage', title: 'Отключение', description: 'Работы', systems: [], startsAt: at, endsAt: at },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'event_invalid' });
  });
});
