import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { ApartmentAccessGrant, HouseRegistration, InviteCheck } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';

type IdParams = { id: string };
type HouseParams = { houseId: string };
type RegistrationBody = { address: string; locality: string; garHouseGuid?: string; apartmentNumber: string };
type RequestBody = { houseId: string; apartmentNumber: string };
type DecisionBody = { decision: 'approve' | 'reject' };
type InviteBody = { apartmentId: string };
type InviteRecord = { id: string; house_id: string; apartment_id: string; created_by_membership_id: string; number: string; address: string; locality: string; expires_at: Date; revoked_at: Date | null; consumed_at?: Date | null; consumed_by_resident_id?: string | null };

const codeHash = (code: string) => createHash('sha256').update(code).digest();
const asRegistration = (row: Record<string, unknown>): HouseRegistration => ({
  id: String(row.id), address: String(row.address), locality: String(row.locality),
  ...(row.gar_house_guid ? { garHouseGuid: String(row.gar_house_guid) } : {}),
  headman: {
    name: String(row.display_name), apartment: String(row.apartment_number),
    ...(row.username ? { username: String(row.username) } : {}),
    ...(row.phone ? { phone: String(row.phone) } : {}),
  },
  submittedAt: new Date(String(row.submitted_at)).toISOString(), status: row.status as HouseRegistration['status'],
  ...(row.decided_at ? { decidedAt: new Date(String(row.decided_at)).toISOString() } : {}),
  ...(row.rejection_reason ? { rejectionReason: String(row.rejection_reason) } : {}),
});

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function registerHouseRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Querystring: { query?: string } }>('/api/houses/search', {
    preHandler: authenticated,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 100 } } } },
  }, async (request) => {
    const query = request.query.query?.trim();
    if (!query || query.length < 2) return { houses: [] };
    const result = await pool.query<{ id: string; address: string; locality: string }>(
      `SELECT id, address, locality FROM houses
        WHERE lower(address || ' ' || locality) LIKE '%' || lower($1) || '%'
        ORDER BY address, locality LIMIT 20`, [query],
    );
    return { houses: result.rows.map((row) => ({ id: row.id, address: row.address, locality: row.locality })) };
  });

  app.post<{ Body: RegistrationBody }>('/api/houses/registrations', {
    preHandler: authenticated,
    schema: { body: { type: 'object', required: ['address', 'locality', 'apartmentNumber'], additionalProperties: false,
      properties: { address: { type: 'string', minLength: 3, maxLength: 300 }, locality: { type: 'string', minLength: 2, maxLength: 200 }, garHouseGuid: { type: 'string', format: 'uuid' }, apartmentNumber: { type: 'string', pattern: '^[1-9][0-9]{0,3}[а-яА-Яa-zA-Z]?$' } } } },
  }, async (request, reply) => {
    const { address, locality, garHouseGuid, apartmentNumber } = request.body;
    const user = request.authSession!.resident;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO house_registrations (submitted_by_resident_id, address, locality, gar_house_guid, apartment_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, address.trim(), locality.trim(), garHouseGuid ?? null, apartmentNumber.trim().toLocaleUpperCase('ru-RU')],
    );
    return reply.code(201).send({ id: result.rows[0]!.id, status: 'pending' });
  });

  app.get('/api/houses/registrations/mine', { preHandler: authenticated }, async (request) => {
    const result = await pool.query(
      `SELECT r.*, p.display_name, p.username, p.phone FROM house_registrations r
       JOIN residents p ON p.id = r.submitted_by_resident_id
       WHERE r.submitted_by_resident_id = $1 ORDER BY r.submitted_at DESC LIMIT 1`,
      [request.authSession!.resident.id],
    );
    return { registration: result.rows[0] ? asRegistration(result.rows[0]) : null };
  });

  app.post<{ Params: HouseParams; Body: InviteBody }>('/api/houses/:houseId/invitations', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['apartmentId'], additionalProperties: false, properties: { apartmentId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const { houseId } = request.params;
    const { apartmentId } = request.body;
    const access = await findHouseAccess(pool, request.authSession!.resident.id, houseId);
    // Администратор Дома приглашает в любую Квартиру, Жилец — только в свою.
    const allowed = access && (access.role === 'admin' || (access.role === 'resident' && access.apartmentId === apartmentId));
    if (!allowed) return reply.code(403).send({ error: 'forbidden' });
    const code = randomBytes(16).toString('base64url');
    const expiresAt = await inTransaction(pool, async (client) => {
      const apartment = await client.query('SELECT id FROM apartments WHERE id = $1 AND house_id = $2 FOR UPDATE', [apartmentId, houseId]);
      if (!apartment.rowCount) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      await client.query('UPDATE invitations SET revoked_at = now() WHERE apartment_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL', [apartmentId]);
      const inserted = await client.query<{ expires_at: Date }>('INSERT INTO invitations (house_id, apartment_id, created_by_membership_id, code_hash) VALUES ($1, $2, $3, $4) RETURNING expires_at', [houseId, apartmentId, access.id, codeHash(code)]);
      return inserted.rows[0]!.expires_at.toISOString();
    });
    return reply.code(201).send({ code, expiresAt });
  });

  app.delete<{ Params: { houseId: string; code: string } }>('/api/houses/:houseId/invitations/:code', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['houseId', 'code'], properties: { houseId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } } } },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access || !['admin', 'resident'].includes(access.role)) return reply.code(403).send({ error: 'forbidden' });
    const result = await pool.query(
      `UPDATE invitations SET revoked_at = now()
        WHERE house_id = $1 AND code_hash = $2 AND revoked_at IS NULL AND consumed_at IS NULL
          AND ($3::boolean OR created_by_membership_id = $4)`,
      [access.houseId, codeHash(request.params.code), access.role === 'admin', access.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'invitation_not_found' });
    return reply.code(204).send();
  });

  app.get<{ Params: IdParams }>('/api/invitations/:id', { preHandler: authenticated, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } } } } }, async (request): Promise<{ invitation: InviteCheck }> => {
    const result = await pool.query<InviteRecord>(
      `SELECT i.id, i.house_id, i.apartment_id, a.number, h.address, h.locality, i.expires_at, i.revoked_at, i.consumed_at
       FROM invitations i JOIN apartments a ON a.id = i.apartment_id AND a.house_id = i.house_id
       JOIN houses h ON h.id = i.house_id WHERE i.code_hash = $1`, [codeHash(request.params.id)],
    );
    const invite = result.rows[0];
    if (!invite) return { invitation: { status: 'not-found' } };
    if (invite.revoked_at) return { invitation: { status: 'revoked' } };
    if (invite.expires_at <= new Date()) return { invitation: { status: 'expired' } };
    const member = await findHouseAccess(pool, request.authSession!.resident.id, invite.house_id);
    if (!member) return { invitation: { status: 'not-house-member' } };
    if (invite.consumed_at) return { invitation: { status: 'used' } };
    return { invitation: { status: 'valid', apartment: invite.number, houseAddress: invite.address } };
  });

  app.post<{ Params: IdParams }>('/api/invitations/:id/redeem', { preHandler: authenticated, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } } } } }, async (request, reply) => {
    try {
      const membership = await inTransaction(pool, async (client) => {
        const result = await client.query<InviteRecord>(
          `SELECT i.id, i.house_id, i.apartment_id, i.created_by_membership_id, a.number, h.address, h.locality, i.expires_at, i.revoked_at, i.consumed_at, i.consumed_by_resident_id
           FROM invitations i JOIN apartments a ON a.id = i.apartment_id AND a.house_id = i.house_id
           JOIN houses h ON h.id = i.house_id WHERE i.code_hash = $1 FOR UPDATE OF i`, [codeHash(request.params.id)],
        );
        const invite = result.rows[0];
        if (!invite || invite.revoked_at || invite.expires_at <= new Date()) return null;
        const residentId = request.authSession!.resident.id;
        const current = await client.query<{ id: string }>('SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL FOR UPDATE', [residentId, invite.house_id]);
        if (!current.rowCount) return null;
        if (invite.consumed_at) {
          if (invite.consumed_by_resident_id !== residentId) return null;
          const prior = await client.query<{ id: string }>('SELECT id FROM apartment_access_grants WHERE apartment_id = $1 AND resident_id = $2 AND revoked_at IS NULL', [invite.apartment_id, residentId]);
          return prior.rows[0] ? { id: prior.rows[0].id, houseId: invite.house_id } : null;
        }
        const existing = await client.query<{ id: string }>('SELECT id FROM apartment_access_grants WHERE apartment_id = $1 AND resident_id = $2 AND revoked_at IS NULL', [invite.apartment_id, residentId]);
        let grantId = existing.rows[0]?.id;
        if (!grantId) {
          const created = await client.query<{ id: string }>(
            'INSERT INTO apartment_access_grants (house_id, apartment_id, granted_by_membership_id, resident_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [invite.house_id, invite.apartment_id, invite.created_by_membership_id, residentId],
          );
          grantId = created.rows[0]!.id;
        }
        await client.query('UPDATE invitations SET consumed_at = now(), consumed_by_resident_id = $2 WHERE id = $1', [invite.id, residentId]);
        return { id: grantId, houseId: invite.house_id };
      });
      if (!membership) return reply.code(404).send({ error: 'invitation_unavailable' });
      return { grant: membership };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'already_a_member' });
      throw error;
    }
  });

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/apartment-access', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply): Promise<{ grants: ApartmentAccessGrant[] } | unknown> => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor) return reply.code(403).send({ error: 'forbidden' });
    if (actor.role !== 'admin' && actor.role !== 'resident') return reply.code(403).send({ error: 'forbidden' });
    if (actor.role === 'resident' && !actor.apartmentId) return reply.code(403).send({ error: 'apartment_required' });
    const result = await pool.query<{ id: string; house_id: string; apartment_id: string; apartment_number: string; resident_name: string; created_at: Date }>(
      `SELECT grant_row.id, grant_row.house_id, grant_row.apartment_id, apartment.number AS apartment_number,
              resident.display_name AS resident_name, grant_row.created_at
         FROM apartment_access_grants grant_row
         JOIN apartments apartment ON apartment.id = grant_row.apartment_id AND apartment.house_id = grant_row.house_id
         JOIN residents resident ON resident.id = grant_row.resident_id
        WHERE grant_row.house_id = $1 AND grant_row.revoked_at IS NULL
          AND ($2::boolean OR grant_row.apartment_id = $3)
          AND ($2::boolean OR grant_row.granted_by_membership_id = $4)
        ORDER BY grant_row.created_at DESC`,
      [actor.houseId, actor.role === 'admin', actor.apartmentId, actor.id],
    );
    return { grants: result.rows.map((row) => ({ id: row.id, houseId: row.house_id, apartmentId: row.apartment_id, apartment: row.apartment_number, residentName: row.resident_name, createdAt: row.created_at.toISOString() })) };
  });

  app.delete<{ Params: { houseId: string; grantId: string } }>('/api/houses/:houseId/apartment-access/:grantId', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['houseId', 'grantId'], properties: { houseId: { type: 'string', format: 'uuid' }, grantId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor) return reply.code(403).send({ error: 'forbidden' });
    const result = await pool.query(
      `UPDATE apartment_access_grants SET revoked_at = now()
        WHERE id = $1 AND house_id = $2 AND revoked_at IS NULL
          AND ($3::boolean OR granted_by_membership_id = $4)`,
      [request.params.grantId, actor.houseId, actor.role === 'admin', actor.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'access_not_found' });
    return reply.code(204).send();
  });

  app.post<{ Body: RequestBody }>('/api/join-requests', {
    preHandler: authenticated,
    schema: { body: { type: 'object', required: ['houseId', 'apartmentNumber'], additionalProperties: false, properties: { houseId: { type: 'string', format: 'uuid' }, apartmentNumber: { type: 'string', pattern: '^[1-9][0-9]{0,3}[а-яА-Яa-zA-Z]?$', maxLength: 5 } } } },
  }, async (request, reply) => {
    const house = await pool.query('SELECT id FROM houses WHERE id = $1', [request.body.houseId]);
    if (!house.rowCount) return reply.code(404).send({ error: 'house_not_found' });
    const activeMembership = await pool.query('SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [request.authSession!.resident.id, request.body.houseId]);
    if (activeMembership.rowCount) return reply.code(409).send({ error: 'already_a_member' });
    try {
      const result = await inTransaction(pool, async (client) => {
        const apartment = await client.query<{ id: string }>(
          'INSERT INTO apartments (house_id, number) VALUES ($1, $2) ON CONFLICT (house_id, number) DO UPDATE SET number = EXCLUDED.number RETURNING id',
          [request.body.houseId, request.body.apartmentNumber.trim().toLocaleUpperCase('ru-RU')],
        );
        return client.query<{ id: string }>(
          'INSERT INTO join_requests (house_id, apartment_id, resident_id) VALUES ($1, $2, $3) RETURNING id',
          [request.body.houseId, apartment.rows[0]!.id, request.authSession!.resident.id],
        );
      });
      return reply.code(201).send({ id: result.rows[0]!.id, status: 'pending' });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'request_already_pending' });
      throw error;
    }
  });

  app.delete<{ Params: IdParams }>('/api/join-requests/:id', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const result = await pool.query(
      "DELETE FROM join_requests WHERE id = $1 AND resident_id = $2 AND status = 'pending'",
      [request.params.id, request.authSession!.resident.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'request_not_found' });
    return reply.code(204).send();
  });

  app.post<{ Params: IdParams; Body: DecisionBody }>('/api/join-requests/:id/decision', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['approve', 'reject'] } } } },
  }, async (request, reply) => {
    const result = await inTransaction(pool, async (client) => {
      const found = await client.query<{ id: string; house_id: string; apartment_id: string; resident_id: string; status: string }>(
        'SELECT id, house_id, apartment_id, resident_id, status FROM join_requests WHERE id = $1 FOR UPDATE', [request.params.id],
      );
      const joinRequest = found.rows[0];
      if (!joinRequest) return { status: 404 as const };
      if (joinRequest.status !== 'pending') return { status: 409 as const };
      await client.query('SELECT id FROM apartments WHERE id = $1 FOR UPDATE', [joinRequest.apartment_id]);
      const memberships = await client.query<{ id: string; role: string; resident_id: string }>(
        `SELECT id, role, resident_id FROM memberships WHERE house_id = $1 AND ended_at IS NULL
         AND (((apartment_id = $2) AND role IN ('resident', 'admin')) OR (role = 'admin' AND NOT EXISTS (
           SELECT 1 FROM memberships resident_member WHERE resident_member.apartment_id = $2 AND resident_member.ended_at IS NULL
         ))) FOR UPDATE`, [joinRequest.house_id, joinRequest.apartment_id],
      );
      const actor = memberships.rows.find(({ id, resident_id: actorResidentId }) =>
        actorResidentId !== joinRequest.resident_id && request.authSession!.memberships.some((item) => item.id === id),
      );
      if (!actor) return { status: 403 as const };
      if (request.body.decision === 'approve') {
        const existing = await client.query('SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL', [joinRequest.resident_id, joinRequest.house_id]);
        if (existing.rowCount) return { status: 409 as const };
        await client.query("INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'resident')", [joinRequest.house_id, joinRequest.apartment_id, joinRequest.resident_id]);
      }
      await client.query('UPDATE join_requests SET status = $2, decided_at = now(), decided_by_membership_id = $3 WHERE id = $1', [joinRequest.id, request.body.decision === 'approve' ? 'approved' : 'rejected', actor.id]);
      return { status: 200 as const, decision: request.body.decision };
    });
    if (result.status !== 200) return reply.code(result.status).send({ error: result.status === 404 ? 'not_found' : result.status === 403 ? 'forbidden' : 'already_decided' });
    return { status: result.decision };
  });
}
