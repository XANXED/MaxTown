import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { signMaxContact } from '../auth/max-contact.ts';
import { signMaxInitData } from '../auth/max-init-data.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { createFakeMax, member, type FakeMax } from '../max/fake-max.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const BOT_TOKEN = 'test-bot-token';

function initData(userId: number, firstName = `Жилец ${userId}`): string {
  return signMaxInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: firstName, username: `user${userId}` }),
  }, BOT_TOKEN);
}

describe.skipIf(!databaseUrl)('вход через MAX', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let max: FakeMax;

  const login = (userId: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: initData(userId), ...extra } });
  const me = (token: string) => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    await pool.query('TRUNCATE TABLE house_chat_onboardings');
    max = createFakeMax();
    app = await buildApp({ pool, env: { NODE_ENV: 'test', BOT_TOKEN, MAX_CHAT_NOTIFICATIONS: 'off' }, max });
  });

  afterEach(async () => { await app.close(); });

  it('меняет подписанный initData на серверную сессию и отдаёт /api/me', async () => {
    const response = await login(90101);

    expect(response.statusCode, response.body).toBe(200);
    const session = response.json<{ token: string; expiresAt: string; pendingHouseSetups: unknown[] }>();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.pendingHouseSetups).toEqual([]);

    const stored = await pool.query<{ token_hash: Buffer }>(
      'SELECT s.token_hash FROM sessions s JOIN residents r ON r.id = s.resident_id WHERE r.max_user_id = $1', ['90101'],
    );
    expect(stored.rows[0]!.token_hash).toEqual(createHash('sha256').update(session.token).digest());

    const profile = await me(session.token);
    expect(profile.json()).toMatchObject({ resident: { maxUserId: '90101', displayName: 'Жилец 90101', username: 'user90101' }, memberships: [] });
  });

  it('отклоняет подделанный initData, чужой токен бота и неизвестную сессию', async () => {
    const forged = new URLSearchParams(initData(90102));
    forged.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }));
    const otherBot = signMaxInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5, first_name: 'Бот' }) }, 'other-token');

    expect((await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: forged.toString() } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/max', payload: { initData: otherBot } })).statusCode).toBe(401);
    expect((await me('x'.repeat(43))).statusCode).toBe(401);
  });

  it('даёт Дом и Роль по участию в Домовом чате и снимает их, когда человек ушёл', async () => {
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('Комендантский пр-кт, д 14 к 1', 'г Санкт-Петербург') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id, created_by_max_user_id) VALUES ($1, $2, $3)', [-500, house.rows[0]!.id, 7]);
    max.chats.set(-500, { title: 'Комендантский 14к1', botIsAdmin: true, members: [member(7), member(8, { isAdmin: true }), member(9)] });

    const roles = async (userId: number) => {
      const { token } = (await login(userId)).json<{ token: string }>();
      return (await me(token)).json<{ memberships: Array<{ role: string; houseId: string }> }>().memberships.map(({ role }) => role);
    };
    expect(await roles(7)).toEqual(['admin']); // добавил бота
    expect(await roles(8)).toEqual(['admin']); // администратор чата
    expect(await roles(9)).toEqual(['resident']);
    expect(await roles(10)).toEqual([]); // не в чате

    max.chats.get(-500)!.members = [member(7), member(8, { isAdmin: true })];
    expect(await roles(9)).toEqual([]);
  });

  it('сохраняет обязательный профиль первого входа и подтверждённый телефон MAX', async () => {
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Лесная, 12', 'Казань') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id) VALUES ($1, $2)', [-503, house.rows[0]!.id]);
    max.chats.set(-503, { title: 'Лесная 12', botIsAdmin: true, members: [member(20)] });
    const { token } = (await login(20)).json<{ token: string }>();

    expect((await me(token)).json()).toMatchObject({
      memberships: [{ apartmentNumber: null, profileCompleted: false, phoneVisibleToNeighbors: false,
        neighborApartments: { left: null, right: null, below: null, above: null } }],
    });

    const apartmentAccess = await app.inject({
      method: 'POST', url: `/api/houses/${house.rows[0]!.id}/apartment-access`,
      headers: { authorization: `Bearer ${token}` },
      payload: { apartmentNumber: '42а', floor: 6, entrance: 2 },
    });
    expect(apartmentAccess.statusCode, apartmentAccess.body).toBe(201);

    const baseProfile = {
      apartmentNumber: '42а',
      phoneVisibleToNeighbors: true,
      neighborApartments: { left: '41', right: '43', below: '32', above: null },
    };
    const withoutContact = await app.inject({
      method: 'PUT', url: `/api/me/houses/${house.rows[0]!.id}/profile`,
      headers: { authorization: `Bearer ${token}` }, payload: baseProfile,
    });
    expect(withoutContact.statusCode).toBe(400);
    expect(withoutContact.json()).toEqual({ error: 'phone_contact_required' });

    const authDate = String(Math.floor(Date.now() / 1000));
    const saved = await app.inject({
      method: 'PUT', url: `/api/me/houses/${house.rows[0]!.id}/profile`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...baseProfile, phoneContact: signMaxContact({ phone: '+79991234567', authDate }, '20', BOT_TOKEN) },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      resident: { phone: '+79991234567', phoneVerified: true },
      memberships: [{
        apartmentNumber: '42А', apartmentFloor: 6, apartmentEntrance: 2,
        profileCompleted: true, phoneVisibleToNeighbors: true,
        neighborApartments: { left: '41', right: '43', below: '32', above: null },
      }],
    });

    const stored = await pool.query(
      `SELECT r.phone, r.phone_verified, m.phone_visible_to_neighbors, m.profile_completed_at,
              m.neighbor_apartment_left, m.neighbor_apartment_right,
              m.neighbor_apartment_below, m.neighbor_apartment_above
         FROM residents r JOIN memberships m ON m.resident_id = r.id
        WHERE r.max_user_id = '20'`,
    );
    expect(stored.rows[0]).toMatchObject({
      phone: '+79991234567', phone_verified: true, phone_visible_to_neighbors: true,
      profile_completed_at: expect.any(Date), neighbor_apartment_left: '41',
      neighbor_apartment_right: '43', neighbor_apartment_below: '32', neighbor_apartment_above: null,
    });
  });

  it('не выкидывает человека из Дома, если MAX не ответил', async () => {
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Лесная, 12', 'Казань') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id) VALUES ($1, $2)', [-501, house.rows[0]!.id]);
    max.chats.set(-501, { title: 'Лесная 12', botIsAdmin: true, members: [member(11)] });
    await login(11);

    max.failing = true;
    const response = await login(11);
    expect(response.statusCode).toBe(200);
    expect((await me(response.json<{ token: string }>().token)).json()).toMatchObject({ memberships: [{ role: 'resident' }] });
  });

  it('перепроверяет все Дома, даже если в запуске передан другой chatId', async () => {
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Защитная, 1', 'Казань') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id) VALUES ($1, $2)', [-503, house.rows[0]!.id]);
    max.chats.set(-503, { title: 'Защитная 1', botIsAdmin: true, members: [member(14)] });
    await login(14);

    max.chats.get(-503)!.members = [];
    const response = await login(14, { chatId: -999 });
    const profile = await me(response.json<{ token: string }>().token);

    expect(profile.json()).toMatchObject({ memberships: [] });
  });

  it('показывает выбор адреса только администратору чата', async () => {
    await pool.query("INSERT INTO house_chat_onboardings (chat_id, chat_title, address_required_at) VALUES (-502, 'Наш дом', now())");
    max.chats.set(-502, { title: 'Наш дом', botIsAdmin: true, members: [member(12, { isOwner: true }), member(13)] });

    expect((await login(12)).json()).toMatchObject({ pendingHouseSetups: [{ chatId: -502, chatTitle: 'Наш дом' }] });
    expect((await login(13)).json()).toMatchObject({ pendingHouseSetups: [] });
  });

  it('отзывает сессию при выходе, а без BOT_TOKEN вход выключен', async () => {
    const { token } = (await login(90103)).json<{ token: string }>();
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(logout.statusCode).toBe(204);
    expect((await me(token)).statusCode).toBe(401);

    await app.close();
    app = await buildApp({ pool: createPool(databaseUrl!), env: { NODE_ENV: 'test' }, max: null });
    expect((await login(90104)).statusCode).toBe(503);
  });
});
