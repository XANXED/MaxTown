import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession, getSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('house onboarding routes', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let residentId: string;
  let residentToken: string;
  let otherResidentId: string;
  let otherToken: string;
  let houseId: string;
  let apartmentId: string;
  let headmanToken: string;

  async function createResident(maxUserId: string): Promise<{ id: string; token: string }> {
    const person = await pool.query<{ id: string }>("INSERT INTO residents (max_user_id, display_name) VALUES ($1, 'Тестовый Жилец') RETURNING id", [maxUserId]);
    const session = await createSession(pool, person.rows[0]!.id);
    return { id: person.rows[0]!.id, token: session.token };
  }

  beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Тестовая ' || gen_random_uuid()::text, 'Казань') RETURNING id");
    houseId = house.rows[0]!.id;
    const apartments = await pool.query<{ id: string; number: string }>(
      "INSERT INTO apartments (house_id, number) VALUES ($1, '1') RETURNING id, number", [houseId],
    );
    apartmentId = apartments.rows.find(({ number }) => number === '1')!.id;
    const headman = await createResident('house-route-headman');
    headmanToken = headman.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'admin')", [houseId, apartmentId, headman.id]);
    const resident = await createResident('house-route-resident');
    residentId = resident.id;
    residentToken = resident.token;
    await pool.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [houseId, apartmentId, residentId]);
    const other = await createResident('house-route-other');
    otherResidentId = other.id;
    otherToken = other.token;
    app = await buildApp({ pool, env: { NODE_ENV: 'test' } });
    expect(await getSession(pool, headmanToken)).not.toBeNull();
  });

  afterEach(async () => { await app.close(); });

  it('hashes invite codes, invalidates replaced links, and does not grant House access to an outsider', async () => {
    const headers = { authorization: `Bearer ${headmanToken}` };
    const first = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers, payload: { apartmentId } });
    expect(first.statusCode).toBe(201);
    const firstCode = first.json<{ code: string }>().code;
    expect(firstCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stored = await pool.query<{ code_hash: Buffer }>('SELECT code_hash FROM invitations');
    expect(stored.rows[0]!.code_hash).toEqual(createHash('sha256').update(firstCode).digest());

    const second = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers, payload: { apartmentId } });
    const secondCode = second.json<{ code: string }>().code;
    expect((await app.inject({ method: 'GET', url: `/api/invitations/${firstCode}`, headers })).json()).toMatchObject({ invitation: { status: 'revoked' } });
    expect((await app.inject({ method: 'GET', url: `/api/invitations/${secondCode}`, headers })).json()).toMatchObject({ invitation: { status: 'valid', apartment: '1' } });

    const redeem = await app.inject({ method: 'POST', url: `/api/invitations/${secondCode}/redeem`, headers: { authorization: `Bearer ${otherToken}` } });
    expect(redeem.statusCode).toBe(404);
    expect(redeem.json()).toEqual({ error: 'invitation_unavailable' });
    expect((await pool.query('SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [otherResidentId, houseId])).rowCount).toBe(0);
  });

  it('serializes concurrent invite replacements so only the last code stays active', async () => {
    const headers = { authorization: `Bearer ${headmanToken}` };
    const replies = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers, payload: { apartmentId } })));
    expect(replies.every((reply) => reply.statusCode === 201), replies.map((reply) => `${reply.statusCode}:${reply.body}`).join('\n')).toBe(true);
    const codes = replies.map((reply) => reply.json<{ code: string }>().code);
    const valid = await Promise.all(codes.map((code) => app.inject({ method: 'GET', url: `/api/invitations/${code}`, headers })));
    expect(valid.filter((reply) => reply.json<{ invitation: { status: string } }>().invitation.status === 'valid')).toHaveLength(1);
  });

  it('attaches an active House member to the invited Apartment', async () => {
    await pool.query("INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'resident')", [houseId, otherResidentId]);
    const issued = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers: { authorization: `Bearer ${headmanToken}` }, payload: { apartmentId } });
    const code = issued.json<{ code: string }>().code;

    const redeem = await app.inject({ method: 'POST', url: `/api/invitations/${code}/redeem`, headers: { authorization: `Bearer ${otherToken}` } });

    expect(redeem.statusCode).toBe(200);
    expect((await pool.query<{ apartment_id: string | null }>('SELECT apartment_id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [otherResidentId, houseId])).rows[0]?.apartment_id).toBe(apartmentId);
  });

  it('handles concurrent redemption of one invitation without duplicate membership', async () => {
    await pool.query("INSERT INTO memberships (house_id, resident_id, role) VALUES ($1, $2, 'resident')", [houseId, otherResidentId]);
    const issued = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers: { authorization: `Bearer ${headmanToken}` }, payload: { apartmentId } });
    const code = issued.json<{ code: string }>().code;
    const headers = { authorization: `Bearer ${otherToken}` };
    const replies = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/invitations/${code}/redeem`, headers })));
    expect(replies.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect((await pool.query('SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [otherResidentId, houseId])).rowCount).toBe(1);
  });

  it('lets apartment residents decide requests and only the headman decide for an empty apartment', async () => {
    const apartmentRequest = await app.inject({ method: 'POST', url: '/api/join-requests', headers: { authorization: `Bearer ${otherToken}` }, payload: { houseId, apartmentNumber: '1' } });
    expect(apartmentRequest.statusCode).toBe(201);
    const apartmentDecision = await app.inject({ method: 'POST', url: `/api/join-requests/${apartmentRequest.json<{ id: string }>().id}/decision`, headers: { authorization: `Bearer ${residentToken}` }, payload: { decision: 'approve' } });
    expect(apartmentDecision.statusCode).toBe(200);

    const emptyApplicant = await createResident('house-route-empty-apartment');
    const emptyRequest = await app.inject({ method: 'POST', url: '/api/join-requests', headers: { authorization: `Bearer ${emptyApplicant.token}` }, payload: { houseId, apartmentNumber: '4' } });
    const emptyApartment = await pool.query<{ id: string }>('SELECT id FROM apartments WHERE house_id = $1 AND number = $2', [houseId, '4']);
    const denied = await app.inject({ method: 'POST', url: `/api/join-requests/${emptyRequest.json<{ id: string }>().id}/decision`, headers: { authorization: `Bearer ${residentToken}` }, payload: { decision: 'approve' } });
    const allowed = await app.inject({ method: 'POST', url: `/api/join-requests/${emptyRequest.json<{ id: string }>().id}/decision`, headers: { authorization: `Bearer ${headmanToken}` }, payload: { decision: 'approve' } });
    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect((await pool.query('SELECT id FROM memberships WHERE resident_id = $1 AND apartment_id = $2 AND ended_at IS NULL', [emptyApplicant.id, emptyApartment.rows[0]!.id])).rowCount).toBe(1);
  });

  it('prevents duplicate pending requests and blocks invitation/request authorization across houses', async () => {
    const headers = { authorization: `Bearer ${otherToken}` };
    expect((await app.inject({ method: 'POST', url: '/api/join-requests', headers, payload: { houseId, apartmentNumber: '5' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/join-requests', headers, payload: { houseId, apartmentNumber: '5' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/invitations`, headers, payload: { apartmentId } })).statusCode).toBe(403);
    const pending = await pool.query<{ id: string }>("SELECT id FROM join_requests WHERE resident_id = $1 AND status = 'pending'", [otherResidentId]);
    expect((await app.inject({ method: 'DELETE', url: `/api/join-requests/${pending.rows[0]!.id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/join-requests/${pending.rows[0]!.id}`, headers })).statusCode).toBe(404);
  });

  it('creates authenticated house registration and returns it to its submitter', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/houses/registrations', headers: { authorization: `Bearer ${otherToken}` }, payload: { address: 'ул. Новая, 7', locality: 'Казань', apartmentNumber: '34А' } });
    expect(response.statusCode).toBe(201);
    const mine = await app.inject({ method: 'GET', url: '/api/houses/registrations/mine', headers: { authorization: `Bearer ${otherToken}` } });
    expect(mine.json()).toMatchObject({ registration: { address: 'ул. Новая, 7', status: 'pending', headman: { apartment: '34А' } } });
  });
});
