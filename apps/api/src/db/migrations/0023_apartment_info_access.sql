-- A second, deliberately limited grant: House address and Apartment number only.
-- It does not join the resident to the Apartment household.
CREATE TABLE apartment_info_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  apartment_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  code_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  revoked_at timestamptz,
  consumed_at timestamptz,
  consumed_by_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_membership_id, house_id) REFERENCES memberships(id, house_id)
);
CREATE UNIQUE INDEX apartment_info_invitations_one_active_per_apartment
  ON apartment_info_invitations (apartment_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

CREATE TABLE apartment_info_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  apartment_id uuid NOT NULL,
  granted_by_membership_id uuid NOT NULL,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);
CREATE UNIQUE INDEX apartment_info_access_one_active_per_resident
  ON apartment_info_access_grants (apartment_id, resident_id)
  WHERE revoked_at IS NULL;
CREATE INDEX apartment_info_access_by_grantor
  ON apartment_info_access_grants (granted_by_membership_id, created_at DESC)
  WHERE revoked_at IS NULL;
