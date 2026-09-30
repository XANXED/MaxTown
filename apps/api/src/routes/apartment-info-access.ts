import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { ApartmentInfoAccessGrant, ApartmentInfoInviteCheck } from '@maxtown/shared';
import { findHouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import { inTransaction } from '../db/transaction.ts';

type HouseParams = { houseId: string };
type CodeParams = { code: string };
type HouseCodeParams = HouseParams & CodeParams;
type CreateBody = { apartmentId: string };
type InfoInviteRow = {
  id: string; house_id: string; apartment_id: string; created_by_membership_id: string;
  apartment_number: string; house_address: string; expires_at: Date; revoked_at: Date | null;
  consumed_at: Date | null; consumed_by_resident_id: string | null;
};

const codeHash = (code: string) => createHash('sha256').update(code).digest();
const houseParams = { type: 'object', required: ['houseId'], additionalProperties: false, properties: { houseId: { type: 'string', format: 'uuid' } } } as const;
const codeParams = { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } } } as const;
const houseCodeParams = { type: 'object', required: ['houseId', 'code'], additionalProperties: false, properties: { houseId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } } } as const;

function answerDatabaseProblem(reply: FastifyReply, error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404) {
    return reply.code(404).send({ error: 'apartment_not_found' });
  }
  throw error;
}

export function registerApartmentInfoAccessRoutes(app: FastifyInstance, pool: Pool): void {
  const authenticated = requireAuthentication(pool);

  app.post<{ Params: HouseParams; Body: CreateBody }>('/api/houses/:houseId/apartment-info-access/invitations', {
    preHandler: authenticated,
    schema: {
      params: houseParams,
      body: { type: 'object', required: ['apartmentId'], additionalProperties: false, properties: { apartmentId: { type: 'string', format: 'uuid' } } },
    },
  }, async (request, reply) => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor) return reply.code(403).send({ error: 'forbidden' });
    if (actor.role !== 'admin' && !(actor.role === 'resident' && actor.apartmentId === request.body.apartmentId)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const code = randomBytes(16).toString('base64url');
    try {
      const expiresAt = await inTransaction(pool, async (client) => {
        const apartment = await client.query('SELECT id FROM apartments WHERE id = $1 AND house_id = $2 FOR UPDATE', [request.body.apartmentId, actor.houseId]);
        if (!apartment.rowCount) throw Object.assign(new Error('apartment_not_found'), { statusCode: 404 });
        await client.query('UPDATE apartment_info_invitations SET revoked_at = now() WHERE apartment_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL', [request.body.apartmentId]);
        const inserted = await client.query<{ expires_at: Date }>(
          `INSERT INTO apartment_info_invitations (house_id, apartment_id, created_by_membership_id, code_hash)
           VALUES ($1, $2, $3, $4) RETURNING expires_at`,
          [actor.houseId, request.body.apartmentId, actor.id, codeHash(code)],
        );
        return inserted.rows[0]!.expires_at.toISOString();
      });
      return reply.code(201).send({ code, expiresAt });
    } catch (error) {
      return answerDatabaseProblem(reply, error);
    }
  });

  app.delete<{ Params: HouseCodeParams }>('/api/houses/:houseId/apartment-info-access/invitations/:code', {
    preHandler: authenticated, schema: { params: houseCodeParams },
  }, async (request, reply) => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor || (actor.role !== 'admin' && actor.role !== 'resident')) return reply.code(403).send({ error: 'forbidden' });
    const result = await pool.query(
      `UPDATE apartment_info_invitations SET revoked_at = now()
        WHERE house_id = $1 AND code_hash = $2 AND revoked_at IS NULL AND consumed_at IS NULL
          AND ($3::boolean OR created_by_membership_id = $4)`,
      [actor.houseId, codeHash(request.params.code), actor.role === 'admin', actor.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'invitation_not_found' });
    return reply.code(204).send();
  });

  app.get<{ Params: CodeParams; Reply: { invitation: ApartmentInfoInviteCheck } }>('/api/apartment-info-invitations/:code', {
    preHandler: authenticated, schema: { params: codeParams },
  }, async (request) => {
    const found = await pool.query<InfoInviteRow>(
      `SELECT invitation.id, invitation.house_id, invitation.apartment_id, invitation.created_by_membership_id,
              apartment.number AS apartment_number, house.address AS house_address, invitation.expires_at,
              invitation.revoked_at, invitation.consumed_at, invitation.consumed_by_resident_id
         FROM apartment_info_invitations invitation
         JOIN apartments apartment ON apartment.id = invitation.apartment_id AND apartment.house_id = invitation.house_id
         JOIN houses house ON house.id = invitation.house_id
        WHERE invitation.code_hash = $1`, [codeHash(request.params.code)],
    );
    const invite = found.rows[0];
    if (!invite) return { invitation: { status: 'not-found' } };
    if (invite.revoked_at) return { invitation: { status: 'revoked' } };
    if (invite.expires_at <= new Date()) return { invitation: { status: 'expired' } };
    if (!await findHouseAccess(pool, request.authSession!.resident.id, invite.house_id)) {
      return { invitation: { status: 'not-house-member' } };
    }
    if (invite.consumed_at) return { invitation: { status: 'used' } };
    return { invitation: { status: 'valid', houseAddress: invite.house_address, apartment: invite.apartment_number } };
  });

  app.post<{ Params: CodeParams }>('/api/apartment-info-invitations/:code/redeem', {
    preHandler: authenticated, schema: { params: codeParams },
  }, async (request, reply) => {
    const residentId = request.authSession!.resident.id;
    const grant = await inTransaction(pool, async (client) => {
      const found = await client.query<InfoInviteRow>(
        `SELECT invitation.id, invitation.house_id, invitation.apartment_id, invitation.created_by_membership_id,
                apartment.number AS apartment_number, house.address AS house_address, invitation.expires_at,
                invitation.revoked_at, invitation.consumed_at, invitation.consumed_by_resident_id
           FROM apartment_info_invitations invitation
           JOIN apartments apartment ON apartment.id = invitation.apartment_id AND apartment.house_id = invitation.house_id
           JOIN houses house ON house.id = invitation.house_id
          WHERE invitation.code_hash = $1 FOR UPDATE OF invitation`, [codeHash(request.params.code)],
      );
      const invite = found.rows[0];
      if (!invite || invite.revoked_at || invite.expires_at <= new Date()) return null;
      const membership = await client.query<{ id: string }>(
        'SELECT id FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL FOR UPDATE',
        [residentId, invite.house_id],
      );
      if (!membership.rowCount) return null;
      if (invite.consumed_at) {
        if (invite.consumed_by_resident_id !== residentId) return null;
        const existingGrant = await client.query<{ id: string }>(
          'SELECT id FROM apartment_info_access_grants WHERE apartment_id = $1 AND resident_id = $2 AND revoked_at IS NULL',
          [invite.apartment_id, residentId],
        );
        return existingGrant.rows[0] ? { id: existingGrant.rows[0].id, apartment: invite.apartment_number, houseAddress: invite.house_address } : null;
      }
      const existingGrant = await client.query<{ id: string }>(
        'SELECT id FROM apartment_info_access_grants WHERE apartment_id = $1 AND resident_id = $2 AND revoked_at IS NULL',
        [invite.apartment_id, residentId],
      );
      let id = existingGrant.rows[0]?.id;
      if (!id) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO apartment_info_access_grants (house_id, apartment_id, granted_by_membership_id, resident_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [invite.house_id, invite.apartment_id, invite.created_by_membership_id, residentId],
        );
        id = created.rows[0]!.id;
      }
      await client.query('UPDATE apartment_info_invitations SET consumed_at = now(), consumed_by_resident_id = $2 WHERE id = $1', [invite.id, residentId]);
      return { id, apartment: invite.apartment_number, houseAddress: invite.house_address };
    });
    if (!grant) return reply.code(404).send({ error: 'invitation_unavailable' });
    return { grant: { id: grant.id }, apartment: grant.apartment, houseAddress: grant.houseAddress };
  });

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/apartment-info-access', {
    preHandler: authenticated, schema: { params: houseParams },
  }, async (request, reply): Promise<{ grants: ApartmentInfoAccessGrant[] } | unknown> => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor || (actor.role !== 'admin' && actor.role !== 'resident')) return reply.code(403).send({ error: 'forbidden' });
    if (actor.role === 'resident' && !actor.apartmentId) return reply.code(403).send({ error: 'apartment_required' });
    const rows = await pool.query<{ id: string; apartment_number: string; resident_name: string; created_at: Date }>(
      `SELECT grant_row.id, apartment.number AS apartment_number, resident.display_name AS resident_name, grant_row.created_at
         FROM apartment_info_access_grants grant_row
         JOIN apartments apartment ON apartment.id = grant_row.apartment_id AND apartment.house_id = grant_row.house_id
         JOIN residents resident ON resident.id = grant_row.resident_id
        WHERE grant_row.house_id = $1 AND grant_row.revoked_at IS NULL
          AND ($2::boolean OR grant_row.apartment_id = $3)
          AND ($2::boolean OR grant_row.granted_by_membership_id = $4)
        ORDER BY grant_row.created_at DESC`,
      [actor.houseId, actor.role === 'admin', actor.apartmentId, actor.id],
    );
    return { grants: rows.rows.map((row) => ({ id: row.id, apartment: row.apartment_number, residentName: row.resident_name, createdAt: row.created_at.toISOString() })) };
  });

  app.delete<{ Params: HouseParams & { grantId: string } }>('/api/houses/:houseId/apartment-info-access/:grantId', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['houseId', 'grantId'], additionalProperties: false, properties: { houseId: { type: 'string', format: 'uuid' }, grantId: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const actor = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!actor) return reply.code(403).send({ error: 'forbidden' });
    const result = await pool.query(
      `UPDATE apartment_info_access_grants SET revoked_at = now()
        WHERE id = $1 AND house_id = $2 AND revoked_at IS NULL AND ($3::boolean OR granted_by_membership_id = $4)`,
      [request.params.grantId, actor.houseId, actor.role === 'admin', actor.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'access_not_found' });
    return reply.code(204).send();
  });
}
