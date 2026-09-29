import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HouseEventDetails, HouseStateResponse, RequestDetails, RequestSummary, UserNotification } from '@maxtown/shared';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { runRequestMaintenance } from '../requests/maintenance.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Наименьший настоящий JPEG-заголовок: сигнатура FF D8 FF и немного данных.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

describe.skipIf(!databaseUrl)('Заявки', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  const tokens: Record<string, string> = {};

  async function person(key: string, role: 'resident' | 'admin' | 'management-company', apartment: string | null, house = houseId): Promise<string> {
    const resident = await pool.query<{ id: string }>('INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id', [key, `Имя ${key}`]);
    const residentId = resident.rows[0]!.id;
    const apartmentId = apartment
      ? (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) ON CONFLICT (house_id, number) DO UPDATE SET number = EXCLUDED.number RETURNING id', [house, apartment])).rows[0]!.id
      : null;
    await pool.query('INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)', [house, apartmentId, residentId, role]);
    tokens[key] = (await createSession(pool, residentId)).token;
    return residentId;
  }

  const as = (key: string) => ({ authorization: `Bearer ${tokens[key]}` });
  const url = (path = '') => `/api/houses/${houseId}/requests${path}`;

  async function file(key: string, payload: Record<string, unknown>): Promise<RequestDetails> {
    const response = await app.inject({ method: 'POST', url: url(), headers: as(key), payload });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ request: RequestDetails }>().request;
  }

  const leak = { category: 'Сантехника', subcategory: 'faucet-leak', place: 'apartment', description: 'Течёт кран на кухне. Подставили таз', preferredVisitDate: new Date().toISOString().slice(0, 10) };
  const lift = { category: 'Лифты', subcategory: 'lift-stopped', place: 'common-property', description: 'Не работает лифт во втором подъезде' };

  async function act(key: string, requestId: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: url(`/${requestId}/actions`), headers: as(key), payload });
  }

  async function notifications(key: string): Promise<UserNotification[]> {
    return (await app.inject({ method: 'GET', url: '/api/notifications', headers: as(key) })).json<{ notifications: UserNotification[] }>().notifications;
  }

  async function state(key: string): Promise<HouseStateResponse> {
    return (await app.inject({ method: 'GET', url: `/api/houses/${houseId}/state`, headers: as(key) })).json<{ state: HouseStateResponse }>().state;
  }

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Заявок, 1', 'Казань') RETURNING id")).rows[0]!.id;
    await person('author', 'resident', '12');
    await person('neighbour', 'resident', '14');
    await person('neighbour2', 'resident', null);
    await person('admin', 'admin', '1');
    await person('uk', 'management-company', null);
    const foreignHouse = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Чужая, 2', 'Казань') RETURNING id")).rows[0]!.id;
    await person('foreign', 'resident', '1', foreignHouse);
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('нумерует Заявки Дома и показывает Заявку о Квартире только автору, УК и Администратору', async () => {
    const first = await file('author', leak);
    const second = await file('author', { ...leak, description: 'Не закрывается окно в спальне, дует' });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect(first).toMatchObject({
      status: 'new', place: 'apartment', apartment: '12', title: 'Течёт кран на кухне', relation: 'author',
      actions: ['cancel'], canSupport: false, canComment: true, history: [{ status: 'new' }],
    });
    expect(first.authorName).toBeUndefined();

    expect((await app.inject({ method: 'GET', url: url(`/${first.id}`), headers: as('neighbour') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: url(`/${first.id}`), headers: as('foreign') })).statusCode).toBe(403);
    const forUk = (await app.inject({ method: 'GET', url: url(`/${first.id}`), headers: as('uk') })).json<{ request: RequestDetails }>().request;
    expect(forUk).toMatchObject({ authorName: 'Имя author', apartment: '12', actions: ['take', 'reject'] });

    const neighbourList = (await app.inject({ method: 'GET', url: url(), headers: as('neighbour') })).json<{ requests: RequestSummary[] }>().requests;
    expect(neighbourList).toEqual([]);
    const adminList = (await app.inject({ method: 'GET', url: url(), headers: as('admin') })).json<{ requests: RequestSummary[] }>().requests;
    expect(adminList.map((request) => request.number)).toEqual([2, 1]);
  });

  it('принимает только Категории и подкатегории, подходящие к месту', async () => {
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: url(), headers: as('author'), payload });
    expect((await post({ ...lift, place: 'apartment' })).json()).toEqual({ error: 'category_not_for_place' });
    expect((await post({ ...leak, category: 'Вода', subcategory: undefined })).json()).toEqual({ error: 'subcategory_required' });
    expect((await post({ ...leak, subcategory: 'lift-stopped' })).json()).toEqual({ error: 'subcategory_invalid' });
    // Подводка бывает только в Квартире.
    expect((await post({ ...lift, category: 'Вода', subcategory: 'supply' })).json()).toEqual({ error: 'subcategory_invalid' });
    const other = await file('author', { category: 'Другое', place: 'apartment', description: 'Скрипит пол в коридоре у двери', apartmentNumber: '12' });
    expect(other.subcategory).toBeNull();
    const riser = await file('author', { ...leak, category: 'Вода', subcategory: 'riser' });
    expect(riser.subcategory).toBe('riser');
    const list = (await app.inject({ method: 'GET', url: url(), headers: as('uk') })).json<{ requests: RequestSummary[] }>().requests;
    expect(list.map((request) => request.subcategory)).toEqual(['riser', null]);
    expect((await notifications('uk'))[0]).toMatchObject({ title: 'Новая Заявка № 2 · Вода', text: 'Течёт стояк: Течёт кран на кухне' });
  });

  it('требует Квартиру для Заявки о Квартире, если она не привязана к членству', async () => {
    const response = await app.inject({ method: 'POST', url: url(), headers: as('neighbour2'), payload: leak });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'apartment_required' });
    const withApartment = await file('neighbour2', { ...leak, apartmentNumber: '40' });
    expect(withApartment.apartment).toBe('40');
  });

  it('показывает Заявку об Общем имуществе соседям без автора и не даёт им комментировать', async () => {
    const request = await file('author', lift);
    await app.inject({ method: 'POST', url: url(`/${request.id}/comments`), headers: as('author'), payload: { text: 'Застряли соседи' } });
    await act('uk', request.id, { action: 'take' });
    await app.inject({ method: 'POST', url: url(`/${request.id}/comments`), headers: as('uk'), payload: { text: 'Мастер едет' } });

    const seen = (await app.inject({ method: 'GET', url: url(`/${request.id}`), headers: as('neighbour') })).json<{ request: RequestDetails }>().request;
    expect(seen).toMatchObject({ canComment: false, canSupport: true, actions: [], responsibleName: 'Имя uk' });
    expect(seen.authorName).toBeUndefined();
    expect(seen.apartment).toBeUndefined();
    expect(seen.comments.map((comment) => comment.authorName)).toEqual(['Жилец', 'Имя uk']);
    const comment = await app.inject({ method: 'POST', url: url(`/${request.id}/comments`), headers: as('neighbour'), payload: { text: 'И у нас' } });
    expect(comment.statusCode).toBe(409);
  });

  it('проводит Заявку по статусам и отказывает в чужих действиях', async () => {
    const request = await file('author', leak);
    expect((await act('author', request.id, { action: 'take' })).statusCode).toBe(409);
    expect((await act('neighbour', request.id, { action: 'take' })).statusCode).toBe(404);

    const taken = (await act('uk', request.id, { action: 'take' })).json<{ request: RequestDetails }>().request;
    expect(taken).toMatchObject({ status: 'in-progress', responsibleName: 'Имя uk', actions: ['schedule-visit', 'complete', 'reject'] });
    const visitAt = '2030-01-02T10:30:00.000Z';
    const scheduled = (await act('uk', request.id, { action: 'schedule-visit', scheduledAt: visitAt })).json<{ request: RequestDetails }>().request;
    expect(scheduled.visit).toMatchObject({ scheduledAt: visitAt });

    expect((await act('uk', request.id, { action: 'complete' })).json<{ request: RequestDetails }>().request.status).toBe('done');
    const reopened = (await act('author', request.id, { action: 'not-fixed', note: 'Всё ещё капает' })).json<{ request: RequestDetails }>().request;
    expect(reopened).toMatchObject({ status: 'in-progress', comments: [{ text: 'Всё ещё капает', mine: true }] });
    expect(reopened.history.at(-1)).toMatchObject({ status: 'in-progress', note: 'Жилец ответил: не исправлено' });

    await act('uk', request.id, { action: 'complete' });
    const closed = (await act('author', request.id, { action: 'confirm' })).json<{ request: RequestDetails }>().request;
    expect(closed).toMatchObject({ status: 'closed', actions: [], canComment: false });
    expect(closed.history.map((change) => change.status)).toEqual(['new', 'in-progress', 'done', 'in-progress', 'done', 'closed']);

    const other = await file('author', leak);
    expect((await act('admin', other.id, { action: 'reject' })).json()).toEqual({ error: 'reason_required' });
    const rejected = (await act('admin', other.id, { action: 'reject', note: 'Это зона ответственности собственника' })).json<{ request: RequestDetails }>().request;
    expect(rejected).toMatchObject({ status: 'rejected', history: [{ status: 'new' }, { status: 'rejected', note: 'Это зона ответственности собственника' }] });
  });

  it('уведомляет УК и Администратора о новой Заявке, автора — о ходе, Ответственного — о Комментарии автора', async () => {
    const request = await file('author', leak);
    for (const key of ['uk', 'admin']) {
      expect(await notifications(key)).toEqual([expect.objectContaining({ kind: 'request-new', requestId: request.id, title: 'Новая Заявка № 1 · Сантехника' })]);
    }
    expect(await notifications('author')).toEqual([]);
    await act('uk', request.id, { action: 'take' });
    await app.inject({ method: 'POST', url: url(`/${request.id}/comments`), headers: as('author'), payload: { text: 'Буду дома после шести' } });
    expect((await notifications('author'))[0]).toMatchObject({ kind: 'request-status', title: 'Заявка № 1 взята в работу' });
    expect((await notifications('uk'))[0]).toMatchObject({ kind: 'request-comment', text: 'Буду дома после шести' });
    expect(await notifications('admin')).toHaveLength(1);
  });

  it('«У меня тоже»: не автору, только на открытой Заявке, снимается и подписывает на ход', async () => {
    const request = await file('author', { ...lift, category: 'Уборка', subcategory: 'stairs-litter', description: 'Мусор на лестнице третьего этажа' });
    expect((await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('author') })).statusCode).toBe(409);
    const supported = (await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour') })).json<{ request: RequestDetails }>().request;
    expect(supported).toMatchObject({ supportCount: 1, supportedByMe: true, relation: 'supporter' });
    const mine = (await app.inject({ method: 'GET', url: url(), headers: as('neighbour') })).json<{ requests: RequestSummary[] }>().requests;
    expect(mine).toEqual([expect.objectContaining({ id: request.id, relation: 'supporter' })]);

    await act('uk', request.id, { action: 'take' });
    expect((await notifications('neighbour'))[0]).toMatchObject({ title: 'Заявка № 1 взята в работу', requestId: request.id });

    const removed = (await app.inject({ method: 'DELETE', url: url(`/${request.id}/support`), headers: as('neighbour') })).json<{ request: RequestDetails }>().request;
    expect(removed).toMatchObject({ supportCount: 0, supportedByMe: false });
    await act('uk', request.id, { action: 'complete' });
    expect((await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour') })).statusCode).toBe(409);
  });

  it('Порог: Заявка и две отметки разных Жильцов открывают Аварию, а её закрытие закрывает Заявки', async () => {
    const request = await file('author', lift);
    await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour') });
    expect((await state('author')).systems.find((system) => system.name === 'Лифты')).toMatchObject({ status: 'reported', requestId: request.id });
    await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour2') });

    const linked = (await app.inject({ method: 'GET', url: url(`/${request.id}`), headers: as('author') })).json<{ request: RequestDetails }>().request;
    expect(linked.accidentId).toBeDefined();
    const lifts = (await state('author')).systems.find((system) => system.name === 'Лифты');
    expect(lifts).toMatchObject({ status: 'accident', eventId: linked.accidentId });
    const event = (await app.inject({ method: 'GET', url: `/api/houses/${houseId}/events/${linked.accidentId}`, headers: as('neighbour') })).json<{ event: HouseEventDetails }>().event;
    expect(event).toMatchObject({ kind: 'accident', openedAutomatically: true, linkedRequests: 1, systems: ['Лифты'], title: 'Лифт не работает' });
    expect((await notifications('uk')).map((item) => item.kind)).toContain('accident');

    // Новая Заявка о Системе с открытой Аварией привязывается сразу.
    const late = await file('neighbour', { ...lift, description: 'Лифт стоит между этажами уже час' });
    expect(late.accidentId).toBe(linked.accidentId);

    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/events/${linked.accidentId}/resolve`, headers: as('neighbour') })).statusCode).toBe(403);
    const resolved = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/events/${linked.accidentId}/resolve`, headers: as('uk') });
    expect(resolved.json<{ event: HouseEventDetails }>().event.resolvedAt).toBeDefined();
    for (const id of [request.id, late.id]) {
      const closed = (await app.inject({ method: 'GET', url: url(`/${id}`), headers: as('admin') })).json<{ request: RequestDetails }>().request;
      expect(closed).toMatchObject({ status: 'closed' });
      expect(closed.history.at(-1)).toMatchObject({ status: 'closed', note: 'Авария устранена' });
    }
    expect((await state('author')).systems.every((system) => system.status === 'working')).toBe(true);
  });

  it('Порог не открывает Аварию, если сообщает один и тот же Жилец', async () => {
    for (const description of ['Нет света на кухне', 'Нет света в коридоре', 'Нет света в ванной']) {
      await file('author', { ...lift, category: 'Электричество', subcategory: 'stair-light', description: `${description} второй час` });
    }
    const accidents = await pool.query('SELECT id FROM accidents WHERE house_id = $1', [houseId]);
    expect(accidents.rowCount).toBe(0);
    expect((await state('neighbour')).problems).toHaveLength(3);
  });

  it('проблема Дома уходит из Состояния дома после отклонения', async () => {
    const request = await file('author', lift);
    expect((await state('neighbour')).problems).toEqual([expect.objectContaining({ id: request.id, relation: 'none' })]);
    await act('admin', request.id, { action: 'reject', note: 'Лифт работает, проверили' });
    const after = await state('neighbour');
    expect(after.problems).toEqual([]);
    expect(after.systems.find((system) => system.name === 'Лифты')?.status).toBe('working');
  });

  it('открывает Аварию вручную, забирает свежие Заявки и не даёт открыть вторую по той же Системе', async () => {
    const request = await file('author', { ...lift, category: 'Вода', subcategory: 'no-water', description: 'Нет холодной воды во всём стояке' });
    const payload = { system: 'Вода', title: 'Нет холодной воды', description: 'Прорыв на вводе', scope: 'весь Дом', advice: ['Наберите воду заранее'] };
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/events`, headers: as('author'), payload })).statusCode).toBe(403);
    const opened = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/events`, headers: as('admin'), payload });
    expect(opened.statusCode, opened.body).toBe(201);
    const event = opened.json<{ event: HouseEventDetails }>().event;
    expect(event).toMatchObject({ title: 'Нет холодной воды', author: { name: 'Имя admin', role: 'Администратор Дома' }, linkedRequests: 1 });
    const again = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/events`, headers: as('uk'), payload });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'accident_already_open', eventId: event.id });
    const list = (await app.inject({ method: 'GET', url: `/api/houses/${houseId}/events`, headers: as('neighbour') })).json<{ events: Array<{ id: string }> }>().events;
    expect(list.map((item) => item.id)).toEqual([event.id]);
    expect((await app.inject({ method: 'GET', url: url(`/${request.id}`), headers: as('author') })).json<{ request: RequestDetails }>().request.accidentId).toBe(event.id);
  });

  it('принимает до четырёх фото от автора и показывает их тем, кто видит Заявку', async () => {
    const request = await file('author', lift);
    const upload = (key: string, body: Buffer, type = 'image/jpeg') => app.inject({
      method: 'POST', url: url(`/${request.id}/photos`), headers: { ...as(key), 'content-type': type }, payload: body,
    });
    expect((await upload('neighbour', jpeg)).statusCode).toBe(409);
    expect((await upload('author', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).statusCode).toBe(415);
    expect((await upload('author', jpeg, 'image/svg+xml')).statusCode).toBe(415);
    for (let index = 0; index < 4; index += 1) expect((await upload('author', jpeg)).statusCode).toBe(201);
    expect((await upload('author', jpeg)).json()).toEqual({ error: 'photo_limit_reached' });
    expect((await upload('author', Buffer.concat([jpeg, Buffer.alloc(1_600_000)]))).statusCode).toBe(413);

    const details = (await app.inject({ method: 'GET', url: url(`/${request.id}`), headers: as('neighbour') })).json<{ request: RequestDetails }>().request;
    expect(details.photos).toHaveLength(4);
    const photo = await app.inject({ method: 'GET', url: details.photos[0]!.url, headers: as('neighbour') });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.rawPayload.equals(jpeg)).toBe(true);
    expect((await app.inject({ method: 'GET', url: details.photos[0]!.url, headers: as('foreign') })).statusCode).toBe(403);
    await act('uk', request.id, { action: 'take' });
    expect((await upload('author', jpeg)).json()).toEqual({ error: 'photo_not_allowed' });
  });

  it('напоминает о Выполненной Заявке через 3 дня и закрывает ещё через 2', async () => {
    const request = await file('author', leak);
    await act('uk', request.id, { action: 'take' });
    await act('uk', request.id, { action: 'complete' });
    const doneAt = (await pool.query<{ done_at: Date }>('SELECT done_at FROM requests WHERE id = $1', [request.id])).rows[0]!.done_at;
    const day = 24 * 60 * 60 * 1000;

    expect(await runRequestMaintenance(pool, new Date(doneAt.getTime() + 2 * day))).toEqual({ reminded: 0, closed: 0 });
    expect(await runRequestMaintenance(pool, new Date(doneAt.getTime() + 3 * day + 1000))).toEqual({ reminded: 1, closed: 0 });
    expect((await notifications('author'))[0]).toMatchObject({ title: 'Проверьте Заявку № 1' });
    expect(await runRequestMaintenance(pool, new Date(doneAt.getTime() + 4 * day))).toEqual({ reminded: 0, closed: 0 });
    expect(await runRequestMaintenance(pool, new Date(doneAt.getTime() + 5 * day + 2000))).toEqual({ reminded: 0, closed: 1 });
    const closed = (await app.inject({ method: 'GET', url: url(`/${request.id}`), headers: as('author') })).json<{ request: RequestDetails }>().request;
    expect(closed.status).toBe('closed');
    expect(closed.history.at(-1)?.note).toBe('Закрыта автоматически: ответа не было после напоминания');
  });

  it('не выдаёт одинаковых номеров при одновременной подаче', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      app.inject({ method: 'POST', url: url(), headers: as(index % 2 ? 'author' : 'neighbour'), payload: { ...leak, description: `Течёт кран номер ${index} на кухне` } })));
    expect(responses.map((response) => response.statusCode)).toEqual(Array(6).fill(201));
    const numbers = responses.map((response) => response.json<{ request: RequestDetails }>().request.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('режим ЧС: отменённая привязанная Заявка больше не подтверждает Аварию', async () => {
    const opened = await app.inject({
      method: 'POST', url: `/api/houses/${houseId}/events`, headers: as('uk'),
      payload: { system: 'Лифты', title: 'Не работает лифт', description: 'Лифт стоит на 5-м этаже' },
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const request = await file('author', lift);
    expect(request.accidentId).toBe(opened.json<{ event: HouseEventDetails }>().event.id);
    expect((await state('author')).emergencies[0]).toMatchObject({ confirmedApartments: 1, confirmedByMe: true, canConfirm: false });
    // Привязанная Заявка — часть Аварии, а не отдельная Проблема Дома.
    expect((await state('neighbour')).problems).toEqual([]);

    expect((await act('author', request.id, { action: 'cancel' })).statusCode).toBe(200);
    expect((await state('author')).emergencies[0]).toMatchObject({ confirmedApartments: 0, confirmedByMe: false, canConfirm: true });
  });

  it('режим ЧС: квартиры вместо людей, статус работ, срок и «У меня тоже» на Аварии', async () => {
    const request = await file('author', lift);
    await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour') });
    await app.inject({ method: 'POST', url: url(`/${request.id}/support`), headers: as('neighbour2') });
    const [emergency] = (await state('uk')).emergencies;
    expect(emergency).toMatchObject({
      title: 'Лифт не работает', system: 'Лифты', workStatus: 'checking', confirmedApartments: 3,
      deadlineRevised: false, confirmedByMe: false, canConfirm: true, canWithdraw: false,
    });
    expect(emergency?.expectedResolutionAt).toBeUndefined();
    // Автор уже сообщил Заявкой: отмечать и снимать ему нечего.
    expect((await state('author')).emergencies[0]).toMatchObject({ confirmedByMe: true, canConfirm: false, canWithdraw: false });

    const events = `/api/houses/${houseId}/events/${emergency!.id}`;
    await person('same-flat', 'resident', '14');
    await person('other-flat', 'resident', '20');
    // Второй Жилец той же квартиры не добавляет квартиру.
    const sameFlat = (await app.inject({ method: 'POST', url: `${events}/confirm`, headers: as('same-flat') })).json<{ event: HouseEventDetails }>().event;
    expect(sameFlat.emergency).toMatchObject({ confirmedApartments: 3, confirmedByMe: true, canConfirm: false, canWithdraw: true });
    await app.inject({ method: 'POST', url: `${events}/confirm`, headers: as('other-flat') });
    expect((await state('uk')).emergencies[0]?.confirmedApartments).toBe(4);
    const withdrawn = (await app.inject({ method: 'DELETE', url: `${events}/confirm`, headers: as('other-flat') })).json<{ event: HouseEventDetails }>().event;
    expect(withdrawn.emergency).toMatchObject({ confirmedApartments: 3, confirmedByMe: false, canConfirm: true });

    expect((await app.inject({ method: 'PATCH', url: events, headers: as('author'), payload: { workStatus: 'repairing' } })).statusCode).toBe(403);
    const working = await app.inject({
      method: 'PATCH', url: events, headers: as('uk'), payload: { title: 'Нет холодной воды', workStatus: 'repairing' },
    });
    expect(working.statusCode, working.body).toBe(200);
    expect(working.json<{ event: HouseEventDetails }>().event).toMatchObject({
      title: 'Нет холодной воды', emergency: { workStatus: 'repairing', deadlineRevised: false },
    });
    expect((await notifications('author'))[0]).toMatchObject({ kind: 'accident', title: 'Начались аварийные работы: Нет холодной воды' });

    // Первый срок — «Назначен срок», перенос — «Новый срок», снятый срок — «Срок уточняется».
    const firstDeadline = '2030-01-02T18:00:00.000Z';
    const scheduled = await app.inject({ method: 'PATCH', url: events, headers: as('uk'), payload: { expectedResolutionAt: firstDeadline } });
    expect(scheduled.json<{ event: HouseEventDetails }>().event).toMatchObject({ endsAt: firstDeadline, emergency: { deadlineRevised: false } });
    expect((await notifications('same-flat'))[0]).toMatchObject({ title: 'Назначен срок: Нет холодной воды' });

    const moved = await app.inject({ method: 'PATCH', url: events, headers: as('admin'), payload: { expectedResolutionAt: '2030-01-03T12:00:00.000Z' } });
    expect(moved.json<{ event: HouseEventDetails }>().event.emergency).toMatchObject({ deadlineRevised: true });
    expect((await state('same-flat')).emergencies[0]).toMatchObject({ title: 'Нет холодной воды', deadlineRevised: true, expectedResolutionAt: '2030-01-03T12:00:00.000Z' });
    expect((await notifications('same-flat'))[0]).toMatchObject({ title: 'Новый срок: Нет холодной воды' });

    const unknown = await app.inject({ method: 'PATCH', url: events, headers: as('uk'), payload: { expectedResolutionAt: null } });
    expect(unknown.json<{ event: HouseEventDetails }>().event.endsAt).toBeUndefined();
    expect((await state('same-flat')).emergencies[0]?.expectedResolutionAt).toBeUndefined();
    expect((await notifications('same-flat'))[0]).toMatchObject({ title: 'Срок уточняется: Нет холодной воды' });

    await app.inject({ method: 'POST', url: `${events}/resolve`, headers: as('uk') });
    expect((await state('same-flat')).emergencies).toEqual([]);
    expect((await notifications('same-flat'))[0]).toMatchObject({ title: 'Авария устранена: Нет холодной воды' });
    expect((await app.inject({ method: 'POST', url: `${events}/confirm`, headers: as('other-flat') })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: events, headers: as('uk'), payload: { workStatus: 'checking' } })).statusCode).toBe(409);
  });
});
