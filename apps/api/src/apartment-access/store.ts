import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  ApartmentAccessRequest,
  ApartmentAccessState,
  ApartmentLocationInput,
  InviteCheck,
} from '@maxtown/shared';

type Db = Pool | PoolClient;
type AccessRole = 'admin' | 'resident' | 'management-company';

type MembershipRow = {
  id: string;
  house_id: string;
  resident_id: string;
  role: AccessRole;
  apartment_id: string | null;
  apartment_household_id: string | null;
};

type ApartmentRow = {
  id: string;
  house_id: string;
  number: string;
  floor: number | null;
  entrance: number | null;
  layout_column: number | null;
};

type RequestRow = {
  id: string;
  house_id: string;
  apartment_id: string;
  apartment_household_id: string;
  resident_id: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: Date;
  number: string;
  floor: number | null;
  entrance: number | null;
  display_name: string;
};

type InvitationRow = {
  id: string;
  house_id: string;
  apartment_id: string;
  apartment_household_id: string | null;
  number: string;
  address: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  household_ended_at: Date | null;
};

const APARTMENT_NUMBER_PATTERN = /^[1-9][0-9]{0,3}[а-яa-z]?$/iu;
const codeHash = (code: string) => createHash('sha256').update(code).digest();

export class ApartmentAccessProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function normalizeApartmentNumber(value: string): string | null {
  const normalized = value.trim().toLocaleUpperCase('ru-RU');
  return APARTMENT_NUMBER_PATTERN.test(normalized) ? normalized : null;
}

function normalizedLocation(input: ApartmentLocationInput): Required<ApartmentLocationInput> {
  const apartmentNumber = normalizeApartmentNumber(input.apartmentNumber);
  const entrance = input.entrance ?? null;
  if (!apartmentNumber || !Number.isInteger(input.floor) || input.floor < 1 || input.floor > 200
      || (entrance !== null && (!Number.isInteger(entrance) || entrance < 1 || entrance > 100))) {
    throw new ApartmentAccessProblem(400, 'apartment_location_invalid');
  }
  return { apartmentNumber, floor: input.floor, entrance };
}

async function lockMembership(db: Db, residentId: string, houseId: string): Promise<MembershipRow> {
  const result = await db.query<MembershipRow>(
    `SELECT id, house_id, resident_id, role, apartment_id, apartment_household_id
       FROM memberships
      WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL
      FOR UPDATE`,
    [residentId, houseId],
  );
  const membership = result.rows[0];
  if (!membership) throw new ApartmentAccessProblem(404, 'house_membership_not_found');
  if (membership.role === 'management-company') throw new ApartmentAccessProblem(403, 'apartment_access_forbidden');
  return membership;
}

async function lockApartment(db: Db, houseId: string, number: string): Promise<ApartmentRow> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${houseId}:${number}`]);
  await db.query(
    `INSERT INTO apartments (house_id, number) VALUES ($1, $2)
     ON CONFLICT (house_id, number) DO NOTHING`,
    [houseId, number],
  );
  const result = await db.query<ApartmentRow>(
    `SELECT id, house_id, number, floor, entrance, layout_column
       FROM apartments WHERE house_id = $1 AND number = $2 FOR UPDATE`,
    [houseId, number],
  );
  return result.rows[0]!;
}

async function ensureActiveHousehold(db: Db, apartment: ApartmentRow): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM apartment_households
      WHERE apartment_id = $1 AND ended_at IS NULL FOR UPDATE`,
    [apartment.id],
  );
  let householdId = existing.rows[0]?.id;
  if (!householdId) {
    const created = await db.query<{ id: string }>(
      `INSERT INTO apartment_households (house_id, apartment_id)
       VALUES ($1, $2) RETURNING id`,
      [apartment.house_id, apartment.id],
    );
    householdId = created.rows[0]!.id;
  }
  await db.query(
    `UPDATE memberships
        SET apartment_household_id = $2
      WHERE apartment_id = $1 AND ended_at IS NULL AND role IN ('resident', 'admin')
        AND apartment_household_id IS NULL`,
    [apartment.id, householdId],
  );
  return householdId;
}

async function locationForClaim(db: Db, apartment: ApartmentRow, location: Required<ApartmentLocationInput>): Promise<ApartmentRow> {
  if (apartment.floor !== null && apartment.floor !== location.floor) {
    throw new ApartmentAccessProblem(409, 'apartment_location_conflict');
  }
  if (apartment.entrance !== null && location.entrance !== null && apartment.entrance !== location.entrance) {
    throw new ApartmentAccessProblem(409, 'apartment_location_conflict');
  }
  const result = await db.query<ApartmentRow>(
    `UPDATE apartments
        SET floor = COALESCE(floor, $2), entrance = COALESCE(entrance, $3)
      WHERE id = $1
      RETURNING id, house_id, number, floor, entrance, layout_column`,
    [apartment.id, location.floor, location.entrance],
  );
  return result.rows[0]!;
}

async function updateOccupiedLocation(
  db: Db,
  apartment: ApartmentRow,
  membershipId: string,
  location: Required<ApartmentLocationInput>,
): Promise<ApartmentRow> {
  const changed = apartment.floor !== location.floor || apartment.entrance !== location.entrance;
  if (!changed) return apartment;
  const repair = await db.query(
    `SELECT 1 FROM apartment_repairs
      WHERE apartment_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
        AND ends_at > now() LIMIT 1`,
    [apartment.id],
  );
  if (repair.rowCount) throw new ApartmentAccessProblem(409, 'apartment_location_locked_by_repair');
  try {
    const result = await db.query<ApartmentRow>(
      `UPDATE apartments
          SET floor = $2, entrance = $3,
              layout_updated_by_membership_id = $4, layout_updated_at = now()
        WHERE id = $1
        RETURNING id, house_id, number, floor, entrance, layout_column`,
      [apartment.id, location.floor, location.entrance, membershipId],
    );
    return result.rows[0]!;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ApartmentAccessProblem(409, 'apartment_location_conflict');
    }
    throw error;
  }
}

function toRequest(row: RequestRow): ApartmentAccessRequest {
  if (row.floor === null) throw new ApartmentAccessProblem(409, 'apartment_location_incomplete');
  return {
    id: row.id,
    apartmentNumber: row.number,
    apartmentFloor: row.floor,
    apartmentEntrance: row.entrance,
    requesterName: row.display_name,
    requestedAt: row.requested_at.toISOString(),
  };
}

const requestSelect = `SELECT request.id, request.house_id, request.apartment_id,
  request.apartment_household_id, request.resident_id, request.status, request.requested_at,
  apartment.number, apartment.floor, apartment.entrance, resident.display_name
  FROM join_requests request
  JOIN apartments apartment ON apartment.id = request.apartment_id AND apartment.house_id = request.house_id
  JOIN residents resident ON resident.id = request.resident_id`;

async function enqueueDirectMessage(
  db: Db,
  recipient: { residentId: string; maxUserId: string | null },
  request: Pick<RequestRow, 'id' | 'house_id'>,
  eventKind: 'apartment-access-request' | 'apartment-access-approved' | 'apartment-access-rejected',
  message: string,
): Promise<void> {
  if (!recipient.maxUserId || !/^[1-9][0-9]*$/.test(recipient.maxUserId)) return;
  await db.query(
    `INSERT INTO max_direct_message_outbox
       (house_id, resident_id, max_user_id, event_kind, message, button_text, button_payload,
        dedupe_key, apartment_access_request_id)
     VALUES ($1, $2, $3::text::bigint, $4, $5, 'Открыть профиль Квартиры',
             'apartment_access_' || $1::uuid::text,
             'apartment-access:' || $4::text || ':' || $6::uuid::text || ':' || $2::uuid::text, $6)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [request.house_id, recipient.residentId, recipient.maxUserId, eventKind, message, request.id],
  );
}

async function notifyHouseholdAboutRequest(db: Db, row: RequestRow): Promise<void> {
  const recipients = await db.query<{ resident_id: string; max_user_id: string | null }>(
    `SELECT DISTINCT membership.resident_id, resident.max_user_id
       FROM memberships membership
       JOIN residents resident ON resident.id = membership.resident_id
      WHERE membership.apartment_household_id = $1 AND membership.ended_at IS NULL
        AND membership.role IN ('resident', 'admin') AND membership.resident_id <> $2`,
    [row.apartment_household_id, row.resident_id],
  );
  for (const recipient of recipients.rows) {
    const title = `Новый запрос в Квартиру ${row.number}`;
    const body = `${row.display_name} просит присоединиться. После подтверждения будут видны платежи и Чеки текущего Домохозяйства, а также история Приборов и Показаний Квартиры.`;
    await db.query(
      `INSERT INTO in_app_notifications
         (resident_id, house_id, kind, title, body, apartment_access_request_id)
       VALUES ($1, $2, 'apartment-access-request', $3, $4, $5)
       ON CONFLICT (resident_id, kind, apartment_access_request_id)
         WHERE apartment_access_request_id IS NOT NULL DO NOTHING`,
      [recipient.resident_id, row.house_id, title, body, row.id],
    );
    await enqueueDirectMessage(
      db,
      { residentId: recipient.resident_id, maxUserId: recipient.max_user_id },
      row,
      'apartment-access-request',
      `${title}. ${body}`,
    );
  }
}

async function notifyDecision(db: Db, row: RequestRow, approved: boolean): Promise<void> {
  const recipient = await db.query<{ resident_id: string; max_user_id: string | null }>(
    `SELECT resident.id AS resident_id, resident.max_user_id
       FROM residents resident WHERE resident.id = $1`,
    [row.resident_id],
  );
  const person = recipient.rows[0];
  if (!person) return;
  const title = approved ? `Запрос в Квартиру ${row.number} подтверждён` : `Запрос в Квартиру ${row.number} отклонён`;
  const body = approved
    ? 'Теперь вам доступны данные текущего Домохозяйства и техническая история Квартиры.'
    : 'Можно отменить ожидание и проверить номер Квартиры у соседей.';
  await db.query(
    `INSERT INTO in_app_notifications
       (resident_id, house_id, kind, title, body, apartment_access_request_id)
     VALUES ($1, $2, 'apartment-access-decision', $3, $4, $5)
     ON CONFLICT (resident_id, kind, apartment_access_request_id)
       WHERE apartment_access_request_id IS NOT NULL DO NOTHING`,
    [person.resident_id, row.house_id, title, body, row.id],
  );
  await enqueueDirectMessage(
    db,
    { residentId: person.resident_id, maxUserId: person.max_user_id },
    row,
    approved ? 'apartment-access-approved' : 'apartment-access-rejected',
    `${title}. ${body}`,
  );
}

export async function readApartmentAccessState(db: Db, residentId: string, houseId: string): Promise<ApartmentAccessState> {
  const membershipResult = await db.query<MembershipRow>(
    `SELECT id, house_id, resident_id, role, apartment_id, apartment_household_id
       FROM memberships WHERE resident_id = $1 AND house_id = $2 AND ended_at IS NULL`,
    [residentId, houseId],
  );
  const membership = membershipResult.rows[0];
  if (!membership) throw new ApartmentAccessProblem(404, 'house_membership_not_found');
  if (membership.role === 'management-company') throw new ApartmentAccessProblem(403, 'apartment_access_forbidden');

  if (membership.apartment_id) {
    const apartmentResult = await db.query<ApartmentRow>(
      `SELECT id, house_id, number, floor, entrance, layout_column
         FROM apartments WHERE id = $1 AND house_id = $2`,
      [membership.apartment_id, houseId],
    );
    const apartment = apartmentResult.rows[0];
    if (!apartment) throw new ApartmentAccessProblem(409, 'apartment_access_inconsistent');
    const incoming = membership.apartment_household_id ? await db.query<RequestRow>(
      `${requestSelect}
        WHERE request.apartment_household_id = $1 AND request.status = 'pending'
        ORDER BY request.requested_at, request.id`,
      [membership.apartment_household_id],
    ) : { rows: [] as RequestRow[] };
    return {
      status: 'joined',
      apartment: {
        id: apartment.id,
        number: apartment.number,
        floor: apartment.floor,
        entrance: apartment.entrance,
      },
      pendingRequest: null,
      incomingRequests: incoming.rows.map(toRequest),
    };
  }

  const pending = await db.query<RequestRow>(
    `${requestSelect}
      JOIN apartment_households household ON household.id = request.apartment_household_id
      WHERE request.resident_id = $1 AND request.house_id = $2 AND request.status = 'pending'
        AND household.ended_at IS NULL
      ORDER BY request.requested_at DESC LIMIT 1`,
    [residentId, houseId],
  );
  return pending.rows[0]
    ? { status: 'pending', pendingRequest: toRequest(pending.rows[0]), incomingRequests: [] }
    : { status: 'unbound', pendingRequest: null, incomingRequests: [] };
}

export async function claimOrRequestApartment(
  db: Db,
  residentId: string,
  houseId: string,
  input: ApartmentLocationInput,
): Promise<{ status: 'joined'; state: ApartmentAccessState } | { status: 'pending'; request: ApartmentAccessRequest }> {
  const location = normalizedLocation(input);
  const membership = await lockMembership(db, residentId, houseId);

  if (membership.apartment_id) {
    const current = await db.query<ApartmentRow>(
      `SELECT id, house_id, number, floor, entrance, layout_column
         FROM apartments WHERE id = $1 AND house_id = $2 FOR UPDATE`,
      [membership.apartment_id, houseId],
    );
    const apartment = current.rows[0]!;
    if (apartment.number !== location.apartmentNumber) {
      throw new ApartmentAccessProblem(409, 'apartment_change_forbidden');
    }
    const householdId = membership.apartment_household_id ?? await ensureActiveHousehold(db, apartment);
    if (!membership.apartment_household_id) {
      await db.query('UPDATE memberships SET apartment_household_id = $2 WHERE id = $1', [membership.id, householdId]);
    }
    await updateOccupiedLocation(db, apartment, membership.id, location);
    return { status: 'joined', state: await readApartmentAccessState(db, residentId, houseId) };
  }

  const existingPending = await db.query<RequestRow>(
    `${requestSelect} WHERE request.resident_id = $1 AND request.house_id = $2 AND request.status = 'pending'
      ORDER BY request.requested_at DESC LIMIT 1 FOR UPDATE OF request`,
    [residentId, houseId],
  );
  if (existingPending.rows[0] && existingPending.rows[0].number !== location.apartmentNumber) {
    throw new ApartmentAccessProblem(409, 'apartment_request_pending');
  }

  let apartment = await lockApartment(db, houseId, location.apartmentNumber);
  const occupants = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM memberships
      WHERE apartment_id = $1 AND ended_at IS NULL AND role IN ('resident', 'admin')`,
    [apartment.id],
  );
  const occupied = Number(occupants.rows[0]!.count) > 0;

  if (!occupied) {
    if (existingPending.rows[0]) {
      await db.query("DELETE FROM join_requests WHERE id = $1 AND status = 'pending'", [existingPending.rows[0].id]);
    }
    apartment = await locationForClaim(db, apartment, location);
    const staleHouseholds = await db.query<{ id: string }>(
      `SELECT id FROM apartment_households WHERE apartment_id = $1 AND ended_at IS NULL`,
      [apartment.id],
    );
    for (const stale of staleHouseholds.rows) await closeHouseholdIfVacant(db, stale.id);
    const household = await db.query<{ id: string }>(
      `INSERT INTO apartment_households (house_id, apartment_id) VALUES ($1, $2) RETURNING id`,
      [houseId, apartment.id],
    );
    await db.query(
      `UPDATE memberships SET apartment_id = $2, apartment_household_id = $3 WHERE id = $1`,
      [membership.id, apartment.id, household.rows[0]!.id],
    );
    return { status: 'joined', state: await readApartmentAccessState(db, residentId, houseId) };
  }

  if (apartment.floor === null) throw new ApartmentAccessProblem(409, 'apartment_location_incomplete');
  if (apartment.floor !== location.floor
      || (apartment.entrance !== null && location.entrance !== null && apartment.entrance !== location.entrance)) {
    throw new ApartmentAccessProblem(409, 'apartment_location_conflict');
  }
  const householdId = await ensureActiveHousehold(db, apartment);
  const samePending = existingPending.rows[0];
  if (samePending) return { status: 'pending', request: toRequest(samePending) };
  const inserted = await db.query<RequestRow>(
    `WITH created AS (
       INSERT INTO join_requests (house_id, apartment_id, apartment_household_id, resident_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT created.id, created.house_id, created.apartment_id, created.apartment_household_id,
            created.resident_id, created.status, created.requested_at,
            apartment.number, apartment.floor, apartment.entrance, resident.display_name
       FROM created
       JOIN apartments apartment ON apartment.id = created.apartment_id
       JOIN residents resident ON resident.id = created.resident_id`,
    [houseId, apartment.id, householdId, residentId],
  );
  const row = inserted.rows[0]!;
  await notifyHouseholdAboutRequest(db, row);
  return { status: 'pending', request: toRequest(row) };
}

export async function cancelApartmentAccessRequest(
  db: Db,
  residentId: string,
  houseId: string,
  requestId: string,
): Promise<void> {
  const result = await db.query(
    `DELETE FROM join_requests
      WHERE id = $1 AND house_id = $2 AND resident_id = $3 AND status = 'pending'`,
    [requestId, houseId, residentId],
  );
  if (!result.rowCount) throw new ApartmentAccessProblem(404, 'apartment_access_request_not_found');
}

export async function decideApartmentAccessRequest(
  db: Db,
  residentId: string,
  houseId: string,
  requestId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  const actor = await lockMembership(db, residentId, houseId);
  const found = await db.query<RequestRow>(
    `${requestSelect} WHERE request.id = $1 AND request.house_id = $2 FOR UPDATE OF request`,
    [requestId, houseId],
  );
  const row = found.rows[0];
  if (!row) throw new ApartmentAccessProblem(404, 'apartment_access_request_not_found');
  if (row.status !== 'pending') throw new ApartmentAccessProblem(409, 'apartment_access_request_decided');
  if (!actor.apartment_household_id || actor.apartment_household_id !== row.apartment_household_id) {
    throw new ApartmentAccessProblem(403, 'apartment_access_decision_forbidden');
  }
  const household = await db.query(
    `SELECT 1 FROM apartment_households WHERE id = $1 AND ended_at IS NULL FOR UPDATE`,
    [row.apartment_household_id],
  );
  if (!household.rowCount) throw new ApartmentAccessProblem(409, 'apartment_household_stale');

  if (decision === 'approve') {
    const applicant = await lockMembership(db, row.resident_id, houseId);
    if (applicant.apartment_id && applicant.apartment_id !== row.apartment_id) {
      throw new ApartmentAccessProblem(409, 'apartment_change_forbidden');
    }
    await db.query(
      `UPDATE memberships SET apartment_id = $2, apartment_household_id = $3 WHERE id = $1`,
      [applicant.id, row.apartment_id, row.apartment_household_id],
    );
    await db.query(
      `UPDATE join_requests SET status = 'rejected', decided_at = now()
        WHERE resident_id = $1 AND house_id = $2 AND status = 'pending' AND id <> $3`,
      [row.resident_id, houseId, row.id],
    );
  }
  await db.query(
    `UPDATE join_requests
        SET status = $2, decided_at = now(), decided_by_membership_id = $3
      WHERE id = $1`,
    [row.id, decision === 'approve' ? 'approved' : 'rejected', actor.id],
  );
  await notifyDecision(db, row, decision === 'approve');
}

export async function createApartmentInvitation(
  db: Db,
  residentId: string,
  houseId: string,
): Promise<string> {
  const membership = await lockMembership(db, residentId, houseId);
  if (!membership.apartment_id || !membership.apartment_household_id) {
    throw new ApartmentAccessProblem(409, 'apartment_access_required');
  }
  const household = await db.query(
    `SELECT 1 FROM apartment_households WHERE id = $1 AND ended_at IS NULL FOR UPDATE`,
    [membership.apartment_household_id],
  );
  if (!household.rowCount) throw new ApartmentAccessProblem(409, 'apartment_household_stale');
  const code = randomBytes(16).toString('base64url');
  await db.query(
    `UPDATE invitations SET revoked_at = now()
      WHERE apartment_household_id = $1 AND revoked_at IS NULL`,
    [membership.apartment_household_id],
  );
  await db.query(
    `INSERT INTO invitations
       (house_id, apartment_id, apartment_household_id, created_by_membership_id, code_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [houseId, membership.apartment_id, membership.apartment_household_id, membership.id, codeHash(code)],
  );
  return code;
}

async function findInvitation(db: Db, code: string, lock = false): Promise<InvitationRow | null> {
  const result = await db.query<InvitationRow>(
    `SELECT invitation.id, invitation.house_id, invitation.apartment_id,
            invitation.apartment_household_id, apartment.number, house.address,
            invitation.expires_at, invitation.revoked_at, household.ended_at AS household_ended_at
       FROM invitations invitation
       JOIN apartments apartment ON apartment.id = invitation.apartment_id AND apartment.house_id = invitation.house_id
       JOIN houses house ON house.id = invitation.house_id
       LEFT JOIN apartment_households household ON household.id = invitation.apartment_household_id
      WHERE invitation.code_hash = $1${lock ? ' FOR UPDATE OF invitation' : ''}`,
    [codeHash(code)],
  );
  return result.rows[0] ?? null;
}

function invitationAvailable(invitation: InvitationRow | null, now = new Date()): invitation is InvitationRow {
  return Boolean(invitation && invitation.apartment_household_id && !invitation.revoked_at
    && !invitation.household_ended_at && (!invitation.expires_at || invitation.expires_at > now));
}

export async function readApartmentInvitation(db: Db, code: string): Promise<InviteCheck> {
  const invitation = await findInvitation(db, code);
  if (!invitation) return { status: 'not-found' };
  if (!invitationAvailable(invitation)) return { status: 'revoked' };
  return { status: 'valid', apartment: invitation.number, houseAddress: invitation.address };
}

export async function redeemApartmentInvitation(
  db: Db,
  residentId: string,
  code: string,
): Promise<{ id: string; houseId: string }> {
  const invitation = await findInvitation(db, code, true);
  if (!invitationAvailable(invitation)) throw new ApartmentAccessProblem(404, 'invitation_unavailable');
  const membership = await lockMembership(db, residentId, invitation.house_id);
  if (membership.apartment_household_id === invitation.apartment_household_id) {
    return { id: membership.id, houseId: invitation.house_id };
  }
  if (membership.apartment_id) throw new ApartmentAccessProblem(409, 'apartment_change_forbidden');
  await db.query(
    `UPDATE memberships SET apartment_id = $2, apartment_household_id = $3 WHERE id = $1`,
    [membership.id, invitation.apartment_id, invitation.apartment_household_id],
  );
  await db.query(
    `UPDATE join_requests SET status = 'rejected', decided_at = now()
      WHERE resident_id = $1 AND house_id = $2 AND status = 'pending'`,
    [residentId, invitation.house_id],
  );
  return { id: membership.id, houseId: invitation.house_id };
}

/** Закрыть Домохозяйство после ухода последнего активного участника. */
export async function closeHouseholdIfVacant(db: Db, householdId: string | null): Promise<void> {
  if (!householdId) return;
  const household = await db.query<{ id: string }>(
    `SELECT id FROM apartment_households WHERE id = $1 AND ended_at IS NULL FOR UPDATE`,
    [householdId],
  );
  if (!household.rowCount) return;
  const occupied = await db.query(
    `SELECT 1 FROM memberships
      WHERE apartment_household_id = $1 AND ended_at IS NULL AND role IN ('resident', 'admin')
      LIMIT 1`,
    [householdId],
  );
  if (occupied.rowCount) return;
  await db.query('UPDATE apartment_households SET ended_at = now() WHERE id = $1', [householdId]);
  await db.query('UPDATE invitations SET revoked_at = now() WHERE apartment_household_id = $1 AND revoked_at IS NULL', [householdId]);
  await db.query(
    `UPDATE join_requests SET status = 'rejected', decided_at = now()
      WHERE apartment_household_id = $1 AND status = 'pending'`,
    [householdId],
  );
}

/** Создать первое Домохозяйство при старой ручной регистрации нового Дома. */
export async function createInitialHousehold(
  db: Db,
  houseId: string,
  apartmentId: string,
  membershipId: string,
): Promise<string> {
  const household = await db.query<{ id: string }>(
    `INSERT INTO apartment_households (house_id, apartment_id) VALUES ($1, $2) RETURNING id`,
    [houseId, apartmentId],
  );
  await db.query(
    `UPDATE memberships SET apartment_household_id = $2 WHERE id = $1`,
    [membershipId, household.rows[0]!.id],
  );
  return household.rows[0]!.id;
}
