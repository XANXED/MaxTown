import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('house community and polls', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let residentId: string;
  let residentToken: string;
  let foreignHouseId: string;
  let foreignToken: string;
  let responsibleToken: string;

  async function createPerson(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, vk_user_id, display_name) VALUES ($1, $1, $1) RETURNING id", [key]);
    const session = await createSession(pool, result.rows[0]!.id);
    return { id: result.rows[0]!.id, token: session.token };
  }

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Сообщества, 1', 'Казань') RETURNING id");
    houseId = house.rows[0]!.id;
    const apartment = await pool.query<{ id: string }>("INSERT INTO apartments (house_id, number) VALUES ($1, '10') RETURNING id", [houseId]);
    const resident = await createPerson('community-resident');
    residentId = resident.id;
    residentToken = resident.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [houseId, apartment.rows[0]!.id, residentId]);
    const responsible = await createPerson('community-responsible');
    responsibleToken = responsible.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'responsible')", [houseId, apartment.rows[0]!.id, responsible.id]);
    const foreignHouse = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Чужая, 5', 'Казань') RETURNING id");
    foreignHouseId = foreignHouse.rows[0]!.id;
    const foreignResident = await createPerson('community-foreign');
    foreignToken = foreignResident.token;
    await pool.query("INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'concierge')", [foreignHouseId, foreignResident.id]);
    app = await buildApp({ pool, env: { NODE_ENV: 'test', VK_GROUP_ID: '123', POLL_VOTER_NULLIFIER_SECRET: 'test-only-poll-voter-nullifier-secret-32-bytes-minimum' } });
  });

  afterEach(async () => { await app.close(); });

  it('stores messages as plain text and serves bounded newest-first pages with an opaque cursor', async () => {
    const headers = { authorization: `Bearer ${residentToken}` };
    const first = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/community/messages`, headers, payload: { body: 'Привет <script>alert(1)</script>' } });
    const second = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/community/messages`, headers, payload: { body: 'Второе сообщение' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const page = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/community/messages?limit=1`, headers });
    const body = page.json<{ messages: Array<{ body: string; id: string }>; nextCursor: string | null }>();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.body).toBe('Второе сообщение');
    expect(body.nextCursor).toBeTruthy();
    const older = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/community/messages?limit=1&before=${body.nextCursor}`, headers });
    expect(older.json<{ messages: Array<{ body: string }> }>().messages[0]?.body).toBe('Привет <script>alert(1)</script>');
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/community/messages?limit=101`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/community/messages?before=broken`, headers })).statusCode).toBe(400);
    const stored = await pool.query<{ body: string; author_membership_id: string }>('SELECT body, author_membership_id FROM community_messages WHERE id = $1', [first.json<{ message: { id: string } }>().message.id]);
    expect(stored.rows[0]?.body).toBe('Привет <script>alert(1)</script>');
    expect(stored.rows[0]?.author_membership_id).toBe((await pool.query('SELECT id FROM memberships WHERE resident_id = $1', [residentId])).rows[0]?.id);
  });

  it('blocks message and poll access to members of a different house', async () => {
    const headers = { authorization: `Bearer ${foreignToken}` };
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/community/messages`, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/community/messages`, headers, payload: { body: 'Чужое сообщение' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/polls`, headers })).statusCode).toBe(403);
  });

  it('stores VK message opt-in only for the authenticated resident', async () => {
    const headers = { authorization: `Bearer ${residentToken}` };
    const current = await app.inject({ method: 'GET', url: '/api/notifications/permission', headers });
    expect(current.json()).toEqual({ status: 'unknown', groupId: 123 });
    const saved = await app.inject({ method: 'POST', url: '/api/notifications/permission', headers, payload: { allowed: true } });
    expect(saved.statusCode).toBe(200);
    const row = await pool.query<{ status: string; consented_at: Date }>('SELECT status, consented_at FROM resident_message_permissions WHERE resident_id = $1', [residentId]);
    expect(row.rows[0]?.status).toBe('allowed');
    expect(row.rows[0]?.consented_at).toBeInstanceOf(Date);
    await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers, payload: { question: 'Первый вопрос?', options: [{ label: 'Да' }, { label: 'Нет' }] } });
    expect((await pool.query("SELECT id FROM vk_notification_outbox WHERE house_id = $1 AND status = 'pending'", [houseId])).rows).toHaveLength(1);
    await app.inject({ method: 'POST', url: '/api/notifications/permission', headers, payload: { allowed: false } });
    expect((await app.inject({ method: 'GET', url: '/api/notifications/permission', headers })).json()).toEqual({ status: 'opted_out', groupId: 123 });
    expect((await pool.query("SELECT id FROM vk_notification_outbox WHERE house_id = $1 AND status = 'denied'", [houseId])).rows).toHaveLength(1);
    await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers, payload: { question: 'Нужно ли созвониться?', options: [{ label: 'Да' }, { label: 'Нет' }] } });
    expect((await pool.query('SELECT id FROM vk_notification_outbox WHERE house_id = $1', [houseId])).rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM in_app_notifications WHERE house_id = $1', [houseId])).rows).toHaveLength(4);
  });

  it('allows every active member to create informal polls and rejects invalid options', async () => {
    const residentHeaders = { authorization: `Bearer ${residentToken}` };
    const responsibleHeaders = { authorization: `Bearer ${responsibleToken}` };
    const payload = { question: 'Какой день удобнее?', options: [{ label: 'Суббота' }, { label: 'Воскресенье' }] };
    await pool.query("INSERT INTO resident_message_permissions (resident_id, status, consented_at) VALUES ($1, 'allowed', now())", [residentId]);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: residentHeaders, payload })).statusCode).toBe(201);
    const inApp = await pool.query<{ resident_id: string }>('SELECT resident_id FROM in_app_notifications WHERE house_id = $1', [houseId]);
    expect(inApp.rows.map(({ resident_id }) => resident_id).sort()).toEqual([residentId, (await pool.query<{ id: string }>('SELECT id FROM residents WHERE vk_user_id = $1', ['community-responsible'])).rows[0]!.id].sort());
    const outbox = await pool.query<{ membership_id: string; resident_id: string; vk_user_id: string }>('SELECT membership_id, resident_id, vk_user_id FROM vk_notification_outbox WHERE house_id = $1', [houseId]);
    expect(outbox.rows).toMatchObject([{ resident_id: residentId, vk_user_id: 'community-resident' }]);
    const feed = await app.inject({ method: 'GET', url: '/api/notifications', headers: residentHeaders });
    expect(feed.json()).toMatchObject({ notifications: [{ kind: 'community-poll', houseId, read: false }] });
    const notificationId = feed.json<{ notifications: Array<{ id: string }> }>().notifications[0]!.id;
    expect((await app.inject({ method: 'PATCH', url: `/api/notifications/${notificationId}/read`, headers: residentHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: residentHeaders, payload: { ...payload, question: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: residentHeaders, payload: { ...payload, options: [{ label: '   ' }, { label: 'Нет' }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: responsibleHeaders, payload: { ...payload, options: [{ label: 'Да' }, { label: 'да ' }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: responsibleHeaders, payload: { ...payload, closesAt: new Date(Date.now() - 1000).toISOString() } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers: responsibleHeaders, payload })).statusCode).toBe(201);
  });

  it('allows one anonymous immutable vote per membership and exposes only own choice plus aggregates', async () => {
    const headers = { authorization: `Bearer ${residentToken}` };
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls`, headers, payload: { question: 'Проводить ли встречу?', options: [{ label: 'Да' }, { label: 'Нет' }] } });
    expect(JSON.stringify(created.json())).not.toContain(residentId);
    expect(JSON.stringify(created.json())).not.toContain('author');
    const poll = created.json<{ poll: { id: string; options: Array<{ id: string }> } }>().poll;
    const votes = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls/${poll.id}/votes`, headers, payload: { optionId: poll.options[0]!.id } })));
    expect(votes.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
    const results = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/polls/${poll.id}/results`, headers });
    expect(results.json()).toMatchObject({ totalVotes: 1, myVoteOptionId: poll.options[0]!.id, options: [{ id: poll.options[0]!.id, votes: 1 }, { id: poll.options[1]!.id, votes: 0 }] });
    expect(JSON.stringify(results.json())).not.toContain(residentId);
    expect(JSON.stringify(results.json())).not.toContain('author');
    const ballots = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'poll_ballots'");
    expect(ballots.rows.map(({ column_name }) => column_name).sort()).toEqual(['option_id', 'poll_id', 'voter_nullifier']);
    const ballot = await pool.query<{ voter_nullifier: Buffer }>('SELECT voter_nullifier FROM poll_ballots WHERE poll_id = $1', [poll.id]);
    expect(ballot.rows[0]?.voter_nullifier).toBeInstanceOf(Buffer);
    expect(ballot.rows[0]?.voter_nullifier).toHaveLength(32);
    const otherVoter = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/polls`, headers: { authorization: `Bearer ${responsibleToken}` } });
    expect(otherVoter.json<{ polls: Array<{ myVoteOptionId: string | null }> }>().polls[0]?.myVoteOptionId).toBeNull();
    const foreignPoll = await app.inject({ method: 'POST', url: `/api/houses/${foreignHouseId}/polls`, headers: { authorization: `Bearer ${foreignToken}` }, payload: { question: 'Чужой опрос', options: [{ label: 'Да' }, { label: 'Нет' }] } });
    const foreignPollId = foreignPoll.json<{ poll: { id: string } }>().poll.id;
    const crossHouseVote = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls/${foreignPollId}/votes`, headers, payload: { optionId: poll.options[0]!.id } });
    expect(crossHouseVote.statusCode).toBe(404);
    await pool.query('UPDATE polls SET closes_at = now() - interval \'1 second\' WHERE id = $1', [poll.id]);
    const closed = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/polls/${poll.id}/votes`, headers: { authorization: `Bearer ${responsibleToken}` }, payload: { optionId: poll.options[1]!.id } });
    expect(closed.statusCode).toBe(409);
  });
});
