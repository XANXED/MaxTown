import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { HouseRegistration } from '@maxtown/shared';
import { requireAuthentication } from '../auth/sessions.ts';

type RegistrationBody = { address: string; locality: string; garHouseGuid?: string; apartmentNumber: string };
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

}
