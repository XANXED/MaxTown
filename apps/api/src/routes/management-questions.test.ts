import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManagementQuestion, ManagementQuestionsResponse, UserNotification } from '@maxtown/shared';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { enqueueWaitingQuestionsForManagement } from '../management-questions/notifications.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

describe.skipIf(!databaseUrl)('Приёмная УК', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  const tokens: Record<string, string> = {};
  const residents: Record<string, string> = {};

  async function person(key: string, role: 'resident' | 'admin' | 'management-company', apartment: string | null = null): Promise<string> {
    const resident = await pool.query<{ id: string }>(
      'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
      [key === 'uk' ? '5005' : key === 'author' ? '5001' : key === 'admin' ? '5003' : '5002', `Имя ${key}`],
    );
    const apartmentId = apartment
      ? (await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, apartment])).rows[0]!.id
      : null;
    await pool.query('INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)', [houseId, apartmentId, resident.rows[0]!.id, role]);
    residents[key] = resident.rows[0]!.id;
    tokens[key] = (await createSession(pool, resident.rows[0]!.id)).token;
    return resident.rows[0]!.id;
  }

  const auth = (key: string) => ({ authorization: `Bearer ${tokens[key]}` });
  const base = () => `/api/houses/${houseId}/management-questions`;
  const create = async (key = 'author') => {
    const response = await app.inject({ method: 'POST', url: base(), headers: auth(key), payload: { title: 'Когда включат отопление?', text: 'На улице уже холодно. Подскажите дату начала сезона.' } });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ question: ManagementQuestion }>().question;
  };
  const notifications = async (key: string) =>
    (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(key) })).json<{ notifications: UserNotification[] }>().notifications;

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    houseId = (await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Приёмная, 1', 'Санкт-Петербург') RETURNING id")).rows[0]!.id;
    await person('author', 'resident', '42');
    await person('reader', 'resident', '43');
    await person('admin', 'admin', '1');
    await person('uk', 'management-company');
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
  });

  afterEach(async () => { await app?.close(); });

  it('показывает публичный вопрос всему Дому без номера Квартиры', async () => {
    const question = await create();
    const list = (await app.inject({ method: 'GET', url: base(), headers: auth('reader') })).json<ManagementQuestionsResponse>();
    expect(list).toMatchObject({ managementAssigned: true, questions: [{ id: question.id, authorName: 'Имя author', state: 'waiting-for-answer' }] });
    const seen = (await app.inject({ method: 'GET', url: `${base()}/${question.id}`, headers: auth('reader') })).json<{ question: ManagementQuestion }>().question;
    expect(seen).toMatchObject({ authorName: 'Имя author', canWrite: false, canClose: false, messages: [{ authorName: 'Имя author', authorRole: 'resident' }] });
    expect(seen).not.toHaveProperty('apartment');
    expect(seen.messages[0]).not.toHaveProperty('apartment');
    expect(await notifications('reader')).toEqual([]);
    expect((await notifications('uk'))[0]).toMatchObject({ kind: 'management-question', managementQuestionId: question.id });
    const direct = await pool.query('SELECT button_text, button_payload, dedupe_key FROM max_direct_message_outbox WHERE management_question_id = $1', [question.id]);
    expect(direct.rows).toEqual([expect.objectContaining({ button_text: 'Открыть вопрос', button_payload: `question_${houseId}_${question.id}` })]);
  });

  it('даёт задавать вопрос Жильцу и Администратору, но отвечать только УК', async () => {
    const question = await create();
    expect((await app.inject({ method: 'POST', url: base(), headers: auth('uk'), payload: { title: 'Тема', text: 'Текст' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${base()}/${question.id}/messages`, headers: auth('reader'), payload: { text: 'Ответ соседа' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${base()}/${question.id}/messages`, headers: auth('admin'), payload: { text: 'Ответ администратора' } })).statusCode).toBe(403);

    const answered = await app.inject({ method: 'POST', url: `${base()}/${question.id}/messages`, headers: auth('uk'), payload: { text: 'Отопление включим 3 октября.' } });
    expect(answered.statusCode, answered.body).toBe(201);
    expect(answered.json<{ question: ManagementQuestion }>().question).toMatchObject({ state: 'answered', messages: [
      { authorRole: 'resident' }, { authorRole: 'management-company', authorName: 'Имя uk' },
    ] });
    expect((await notifications('author'))[0]).toMatchObject({ kind: 'management-answer', managementQuestionId: question.id });

    const adminQuestion = await create('admin');
    expect(adminQuestion.messages[0]).toMatchObject({ authorRole: 'admin', authorName: 'Имя admin' });
  });

  it('закрывает вопрос только автор и возобновляет его обязательным сообщением', async () => {
    const question = await create();
    expect((await app.inject({ method: 'POST', url: `${base()}/${question.id}/close`, headers: auth('uk') })).statusCode).toBe(403);
    const closed = await app.inject({ method: 'POST', url: `${base()}/${question.id}/close`, headers: auth('author') });
    expect(closed.json<{ question: ManagementQuestion }>().question).toMatchObject({ state: 'closed', canReopen: true, canWrite: false });
    expect((await app.inject({ method: 'POST', url: `${base()}/${question.id}/messages`, headers: auth('uk'), payload: { text: 'Поздний ответ' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `${base()}/${question.id}/reopen`, headers: auth('author'), payload: { text: '' } })).statusCode).toBe(400);
    const reopened = await app.inject({ method: 'POST', url: `${base()}/${question.id}/reopen`, headers: auth('author'), payload: { text: 'Вопрос снова актуален' } });
    expect(reopened.json<{ question: ManagementQuestion }>().question).toMatchObject({ state: 'waiting-for-answer', canClose: true, canReopen: false });
  });

  it('принимает до четырёх фото только от автора сообщения', async () => {
    const question = await create();
    const messageId = question.messages[0]!.id;
    const upload = (key: string, body: Buffer, type = 'image/jpeg') => app.inject({
      method: 'POST', url: `${base()}/${question.id}/messages/${messageId}/photos`, headers: { ...auth(key), 'content-type': type }, payload: body,
    });
    expect((await upload('reader', jpeg)).statusCode).toBe(403);
    for (let index = 0; index < 4; index += 1) expect((await upload('author', jpeg)).statusCode).toBe(201);
    expect((await upload('author', jpeg)).statusCode).toBe(409);
    const details = (await app.inject({ method: 'GET', url: `${base()}/${question.id}`, headers: auth('reader') })).json<{ question: ManagementQuestion }>().question;
    expect(details.messages[0]!.photos).toHaveLength(4);
    const photo = details.messages[0]!.photos[0]!;
    expect((await app.inject({ method: 'GET', url: photo.url, headers: auth('reader') })).headers['content-type']).toBe('image/jpeg');
    expect((await upload('author', Buffer.from('not-image'))).statusCode).toBe(415);
  });

  it('идемпотентно доставляет каждый ожидающий вопрос УК при назначении и первом входе', async () => {
    await pool.query("UPDATE memberships SET ended_at = now() WHERE resident_id = $1 AND role = 'management-company'", [residents.uk]);
    const question = await create();
    expect((await app.inject({ method: 'GET', url: base(), headers: auth('author') })).json<ManagementQuestionsResponse>().managementAssigned).toBe(false);

    const future = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, display_name) VALUES ('7007', 'Новая УК') RETURNING id");
    await enqueueWaitingQuestionsForManagement(pool, houseId, 7007, null);
    await enqueueWaitingQuestionsForManagement(pool, houseId, 7007, null);
    expect((await pool.query('SELECT id FROM max_direct_message_outbox WHERE management_question_id = $1 AND max_user_id = 7007', [question.id])).rowCount).toBe(1);

    await pool.query("INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'management-company')", [houseId, future.rows[0]!.id]);
    await enqueueWaitingQuestionsForManagement(pool, houseId, 7007, future.rows[0]!.id);
    await enqueueWaitingQuestionsForManagement(pool, houseId, 7007, future.rows[0]!.id);
    expect((await pool.query('SELECT id FROM in_app_notifications WHERE management_question_id = $1 AND resident_id = $2', [question.id, future.rows[0]!.id])).rowCount).toBe(1);
    expect((await pool.query('SELECT id FROM max_direct_message_outbox WHERE management_question_id = $1 AND max_user_id = 7007', [question.id])).rowCount).toBe(1);
  });
});
