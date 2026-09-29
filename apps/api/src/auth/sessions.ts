import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import type { AuthResident, HouseMembershipSummary } from '@maxtown/shared';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthenticatedSession = {
  sessionId: string;
  expiresAt: string;
  resident: AuthResident;
  memberships: HouseMembershipSummary[];
};

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthenticatedSession | null;
    authToken: string | null;
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(
  pool: Pool,
  residentId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO sessions (resident_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [residentId, tokenHash, now, expiresAt],
  );
  return { token, expiresAt };
}

type SessionRow = {
  session_id: string;
  expires_at: Date;
  resident_id: string;
  max_user_id: string | null;
  display_name: string;
  username: string | null;
  phone: string | null;
  phone_verified: boolean;
  membership_id: string | null;
  membership_house_id: string | null;
  apartment_id: string | null;
  apartment_number: string | null;
  house_address: string | null;
  house_locality: string | null;
  role: HouseMembershipSummary['role'] | null;
};

export async function getSession(pool: Pool, token: string, now = new Date()): Promise<AuthenticatedSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await pool.query<SessionRow>(
    `SELECT
       s.id AS session_id, s.expires_at,
       r.id AS resident_id, r.max_user_id, r.display_name, r.username, r.phone, r.phone_verified,
       m.id AS membership_id, m.house_id AS membership_house_id, m.apartment_id,
       a.number AS apartment_number, h.address AS house_address, h.locality AS house_locality, m.role
     FROM sessions s
     JOIN residents r ON r.id = s.resident_id
     LEFT JOIN memberships m ON m.resident_id = r.id AND m.ended_at IS NULL
     LEFT JOIN houses h ON h.id = m.house_id
     LEFT JOIN apartments a ON a.id = m.apartment_id AND a.house_id = m.house_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
     ORDER BY h.address NULLS LAST, a.number NULLS LAST`,
    [hashToken(token), now],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at.toISOString(),
    resident: {
      id: row.resident_id,
      maxUserId: row.max_user_id,
      displayName: row.display_name,
      username: row.username,
      phone: row.phone,
      phoneVerified: row.phone_verified,
    },
    memberships: result.rows.flatMap((membership) => {
      if (!membership.membership_id || !membership.membership_house_id || !membership.role
        || !membership.house_address || !membership.house_locality) return [];
      return [{
        id: membership.membership_id,
        houseId: membership.membership_house_id,
        apartmentId: membership.apartment_id,
        apartmentNumber: membership.apartment_number,
        address: membership.house_address,
        locality: membership.house_locality,
        role: membership.role,
      }];
    }),
  };
}

export async function revokeSession(pool: Pool, token: string, now = new Date()): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await pool.query(
    'UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token), now],
  );
}

export function requireAuthentication(pool: Pool): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
    if (!match) return reply.code(401).send({ error: 'unauthorized' });

    const session = await getSession(pool, match[1]!);
    if (!session) return reply.code(401).send({ error: 'unauthorized' });

    request.authSession = session;
    request.authToken = match[1]!;
  };
}
