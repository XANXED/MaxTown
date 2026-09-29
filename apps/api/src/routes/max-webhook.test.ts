import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { signMaxInitData } from '../auth/max-init-data.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { createFakeMax, member, type FakeMax } from '../max/fake-max.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const BOT_TOKEN = 'test-bot-token';
const SECRET = 'test-webhook-secret';

function dadataHouse(value: string, guid: string, extra: Record<string, unknown> = {}) {
  return {
    value,
    data: { fias_level: '8', house_fias_id: guid, region_with_type: 'г Санкт-Петербург', city_with_type: 'г Санкт-Петербург', ...extra },
  };
}

describe.skipIf(!databaseUrl)('Домовой чат MAX', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let max: FakeMax;
  let dadata: ReturnType<typeof vi.fn<typeof fetch>>;

  const event = (update: Record<string, unknown>, secret = SECRET) =>
    app.inject({ method: 'POST', url: '/api/max/webhook', headers: { 'x-max-bot-api-secret': secret }, payload: update });
  const loginToken = async (userId: number) => {
    const initData = signMaxInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: 'Админ' }) }, BOT_TOKEN);
    return (await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData } })).json<{ token: string; pendingHouseSetups: unknown[] }>();
  };
  const housesOf = async (token: string) =>
    (await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })).json<{ memberships: Array<{ address: string; role: string }> }>().memberships;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    await pool.query('TRUNCATE TABLE house_chat_onboardings');
    max = createFakeMax();
    dadata = vi.fn<typeof fetch>(async () => Response.json({ suggestions: [] }));
    app = await buildApp({
      pool,
      env: { NODE_ENV: 'test', BOT_TOKEN, MAX_WEBHOOK_SECRET: SECRET, DADATA_API_KEY: 'dadata-key', MAX_CHAT_NOTIFICATIONS: 'off' },
      max,
      dadataFetch: dadata,
    });
  });

  afterEach(async () => { await app.close(); });

  it('без верного секрета события не принимает', async () => {
    expect((await event({ update_type: 'bot_added', chat_id: -1 }, 'wrong-secret-value')).statusCode).toBe(401);
  });

  it('создаёт Дом сам, если DaData однозначно узнала адрес из названия чата', async () => {
    max.chats.set(-600, { title: 'Санкт-Петербург, Комендантский 14к1', botIsAdmin: true, members: [member(21), member(22)] });
    dadata.mockResolvedValue(Response.json({
      suggestions: [dadataHouse('г Санкт-Петербург, Комендантский пр-кт, д 14 к 1', 'gar-14-1', { geo_lat: '60.0078', geo_lon: '30.2586' })],
    }));

    expect((await event({ update_type: 'bot_added', chat_id: -600, user: { user_id: 21 } })).statusCode).toBe(200);

    const house = await pool.query('SELECT h.address, h.locality, h.gar_house_guid, h.lat, h.lon, c.created_by_max_user_id FROM houses h JOIN house_chats c ON c.house_id = h.id WHERE c.chat_id = -600');
    expect(house.rows[0]).toMatchObject({ address: 'Комендантский пр-кт, д 14 к 1', locality: 'г Санкт-Петербург', gar_house_guid: 'gar-14-1', lat: 60.0078, lon: 30.2586, created_by_max_user_id: '21' });
    expect(max.sent.at(-1)?.text).toContain('Дом подключён');

    // Добавивший бота — Администратор Дома, остальные — Жильцы.
    expect(await housesOf((await loginToken(21)).token)).toMatchObject([{ role: 'admin', address: 'Комендантский пр-кт, д 14 к 1' }]);
    expect(await housesOf((await loginToken(22)).token)).toMatchObject([{ role: 'resident' }]);

    // Повторное событие второй Дом не создаёт.
    await event({ update_type: 'bot_admin_permissions_changed', chat_id: -600 });
    expect((await pool.query('SELECT 1 FROM house_chats WHERE chat_id = -600')).rowCount).toBe(1);
  });

  it('при неясном адресе просит администратора выбрать его, и выбор создаёт Дом', async () => {
    max.chats.set(-601, { title: 'Наш дом', botIsAdmin: true, members: [member(31), member(32, { isAdmin: true }), member(33)] });
    await event({ update_type: 'bot_added', chat_id: -601, user: { user_id: 31 } });
    expect(max.sent.at(-1)).toMatchObject({ chatId: -601, button: { text: 'Указать адрес', payload: 'setup_-601' } });

    const admin = await loginToken(32);
    expect(admin.pendingHouseSetups).toEqual([{ chatId: -601, chatTitle: 'Наш дом' }]);
    const resident = await loginToken(33);
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });

    dadata.mockImplementation(async () => Response.json({ suggestions: [dadataHouse('г Санкт-Петербург, ул Лесная, д 12', 'gar-12')] }));
    const forbidden = await app.inject({ method: 'POST', url: '/api/house-setup/suggestions', headers: headers(resident.token), payload: { chatId: -601, query: 'Лесная 12' } });
    expect(forbidden.statusCode).toBe(403);
    const suggestions = await app.inject({ method: 'POST', url: '/api/house-setup/suggestions', headers: headers(admin.token), payload: { chatId: -601, query: 'Лесная 12' } });
    expect(suggestions.json()).toEqual({ suggestions: [{ value: 'г Санкт-Петербург, ул Лесная, д 12', locality: 'г Санкт-Петербург', garHouseGuid: 'gar-12' }] });

    const confirmed = await app.inject({ method: 'POST', url: '/api/house-setup/confirm', headers: headers(admin.token), payload: { chatId: -601, garHouseGuid: 'gar-12' } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await housesOf(admin.token)).toMatchObject([{ role: 'admin', address: 'ул Лесная, д 12' }]);
    // Повтор после потерянного ответа — тот же Дом.
    const again = await app.inject({ method: 'POST', url: '/api/house-setup/confirm', headers: headers(admin.token), payload: { chatId: -601, garHouseGuid: 'gar-other' } });
    expect(again.json()).toEqual(confirmed.json());
  });

  it('без прав администратора Дом закрыт, с возвращёнными правами — открыт снова', async () => {
    max.chats.set(-602, { title: 'Санкт-Петербург, Комендантский 14 к1', botIsAdmin: true, members: [member(41)] });
    dadata.mockImplementation(async () => Response.json({ suggestions: [dadataHouse('г Санкт-Петербург, Комендантский пр-кт, д 14 к 1', 'gar-14-1')] }));
    await event({ update_type: 'bot_added', chat_id: -602, user: { user_id: 41 } });
    const { token } = await loginToken(41);
    expect(await housesOf(token)).toHaveLength(1);

    max.chats.get(-602)!.botIsAdmin = false;
    await event({ update_type: 'bot_admin_permissions_changed', chat_id: -602 });
    expect(await housesOf(token)).toEqual([]);
    expect(max.sent.at(-1)?.text).toContain('выдайте боту права администратора');

    max.chats.get(-602)!.botIsAdmin = true;
    await event({ update_type: 'bot_admin_permissions_changed', chat_id: -602 });
    expect(await housesOf((await loginToken(41)).token)).toHaveLength(1);
  });

  it('/set_uk назначает УК только по команде Администратора Дома', async () => {
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Победы, 31', 'Тольятти') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id) VALUES (-603, $1)', [house.rows[0]!.id]);
    max.chats.set(-603, { title: 'Победы 31', botIsAdmin: true, members: [member(51, { isAdmin: true }), member(52, { username: 'uk_pobedy' }), member(53)] });
    const command = (senderId: number, text: string) => event({
      update_type: 'message_created',
      message: { sender: { user_id: senderId }, recipient: { chat_type: 'chat', chat_id: -603 }, body: { text } },
    });

    await command(53, '/set_uk @uk_pobedy');
    expect(max.sent.at(-1)?.text).toBe('Назначить аккаунт УК может только Администратор Дома.');

    await command(51, '/set_uk @uk_pobedy');
    expect(max.sent.at(-1)?.text).toBe('@uk_pobedy назначен аккаунтом УК для этого Дома.');
    expect(await housesOf((await loginToken(52)).token)).toMatchObject([{ role: 'management-company' }]);
  });

  it('недоступный MAX — не 200, чтобы MAX повторил событие', async () => {
    max.chats.set(-604, { title: 'Дом', botIsAdmin: true, members: [] });
    max.failing = true;
    expect((await event({ update_type: 'bot_added', chat_id: -604 })).statusCode).toBe(502);
  });
});
