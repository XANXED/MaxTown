import type { Pool, PoolClient } from 'pg';
import type { HouseMembershipSummary } from '@maxtown/shared';

export type HouseAccess = HouseMembershipSummary & { residentId: string };

export async function findHouseAccess(
  db: Pool | PoolClient,
  residentId: string,
  houseId: string,
): Promise<HouseAccess | null> {
  const result = await db.query<{
    id: string; house_id: string; apartment_id: string | null; apartment_number: string | null;
    address: string; locality: string; role: HouseMembershipSummary['role']; resident_id: string;
  }>(
    `SELECT m.id, m.house_id, m.apartment_id, a.number AS apartment_number,
            h.address, h.locality, m.role, m.resident_id
       FROM memberships m
       JOIN houses h ON h.id = m.house_id
       LEFT JOIN apartments a ON a.id = m.apartment_id AND a.house_id = m.house_id
      WHERE m.resident_id = $1 AND m.house_id = $2 AND m.ended_at IS NULL
      LIMIT 1`,
    [residentId, houseId],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id, houseId: row.house_id, apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number, address: row.address, locality: row.locality,
    role: row.role, residentId: row.resident_id,
  } : null;
}
