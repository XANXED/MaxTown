import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { HouseRegistration } from '@maxtown/shared';
import { createInitialHousehold } from '../apartment-access/store.ts';

type DecisionBody = { decision: 'approve' | 'reject'; reason?: string };
type RegistrationRow = {
  id: string; address: string; locality: string; gar_house_guid: string | null; apartment_number: string;
  display_name: string; username: string | null; phone: string | null; submitted_at: Date;
  status: HouseRegistration['status']; decided_at: Date | null; rejection_reason: string | null;
};

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function toRegistration(row: RegistrationRow): HouseRegistration {
  return {
    id: row.id, address: row.address, locality: row.locality,
    ...(row.gar_house_guid ? { garHouseGuid: row.gar_house_guid } : {}),
    headman: {
      name: row.display_name, apartment: row.apartment_number,
      ...(row.username ? { username: row.username } : {}), ...(row.phone ? { phone: row.phone } : {}),
    },
    submittedAt: row.submitted_at.toISOString(), status: row.status,
    ...(row.decided_at ? { decidedAt: row.decided_at.toISOString() } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
  };
}

const registrationSelect = `SELECT r.id, r.address, r.locality, r.gar_house_guid, r.apartment_number,
  r.submitted_at, r.status, r.decided_at, r.rejection_reason,
  p.display_name, p.username, p.phone
  FROM house_registrations r JOIN residents p ON p.id = r.submitted_by_resident_id`;

export function registerModeratorRoutes(app: FastifyInstance, pool: Pool): void {
  async function principal(value: string | null): Promise<string | null> {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.@-]{1,100}$/.test(value)) return null;
    const moderator = await pool.query('SELECT 1 FROM moderators WHERE principal = $1 AND disabled_at IS NULL', [value]);
    return moderator.rowCount ? value : null;
  }

  app.get<{ Querystring: { status?: HouseRegistration['status'] } }>(
    '/api/moderator/registrations',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected'] } } } } },
    async (request, reply) => {
      const actor = await principal(request.moderatorPrincipal);
      if (!actor) return reply.code(401).send({ error: 'moderator_authentication_required' });
      const result = request.query.status
        ? await pool.query<RegistrationRow>(`${registrationSelect} WHERE r.status = $1 ORDER BY r.submitted_at ASC`, [request.query.status])
        : await pool.query<RegistrationRow>(`${registrationSelect} ORDER BY r.submitted_at ASC`);
      return { registrations: result.rows.map(toRegistration) };
    },
  );

  app.post<{ Params: { id: string }; Body: DecisionBody }>(
    '/api/moderator/registrations/:id/decision',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['decision'], additionalProperties: false,
          properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 } } },
      },
    },
    async (request, reply) => {
      const actor = await principal(request.moderatorPrincipal);
      if (!actor) return reply.code(401).send({ error: 'moderator_authentication_required' });
      if (request.body.decision === 'reject' && !request.body.reason?.trim()) return reply.code(400).send({ error: 'rejection_reason_required' });
      let result: { status: 404 | 409 } | { status: 200; registration: HouseRegistration };
      try {
        result = await transaction(pool, async (client) => {
        const registration = await client.query<RegistrationRow & { submitted_by_resident_id: string }>(
          `${registrationSelect.replace('SELECT r.id,', 'SELECT r.submitted_by_resident_id, r.id,')} WHERE r.id = $1 FOR UPDATE OF r`, [request.params.id],
        );
        const row = registration.rows[0];
        if (!row) return { status: 404 as const };
        if (row.status !== 'pending') return { status: 409 as const };

        let houseId: string | null = null;
        if (request.body.decision === 'approve') {
          const duplicate = await client.query(
            `SELECT id FROM houses WHERE (address = $1 AND locality = $2)
               OR ($3::text IS NOT NULL AND gar_house_guid = $3) LIMIT 1`,
            [row.address, row.locality, row.gar_house_guid],
          );
          if (duplicate.rowCount) return { status: 409 as const };
          const house = await client.query<{ id: string }>(
            'INSERT INTO houses (address, locality, gar_house_guid) VALUES ($1, $2, $3) RETURNING id',
            [row.address, row.locality, row.gar_house_guid],
          );
          houseId = house.rows[0]!.id;
          const apartment = await client.query<{ id: string }>(
            'INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [houseId, row.apartment_number],
          );
          const membership = await client.query<{ id: string }>(
            "INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
            [houseId, apartment.rows[0]!.id, row.submitted_by_resident_id],
          );
          await createInitialHousehold(client, houseId, apartment.rows[0]!.id, membership.rows[0]!.id);
        }
        const status = request.body.decision === 'approve' ? 'approved' : 'rejected';
        const reason = status === 'rejected' ? request.body.reason!.trim() : null;
        await client.query(
          'UPDATE house_registrations SET status = $2, decided_at = now(), decided_by_principal = $3, rejection_reason = $4, house_id = $5 WHERE id = $1',
          [row.id, status, actor, reason, houseId],
        );
        return { status: 200 as const, registration: { ...toRegistration(row), status, decidedAt: new Date().toISOString(), ...(reason ? { rejectionReason: reason } : {}) } };
        });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          return reply.code(409).send({ error: 'house_already_registered' });
        }
        throw error;
      }
      if (result.status !== 200) return reply.code(result.status).send({ error: result.status === 404 ? 'not_found' : 'already_decided' });
      return { registration: result.registration };
    },
  );
}
