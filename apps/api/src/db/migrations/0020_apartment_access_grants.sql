-- Apartment access is independent from the chat-derived House role and membership.
ALTER TABLE invitations ADD COLUMN consumed_at timestamptz;
ALTER TABLE invitations ADD COLUMN consumed_by_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE invitations ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
UPDATE invitations SET expires_at = created_at + interval '7 days' WHERE expires_at IS NULL;
ALTER TABLE invitations ALTER COLUMN expires_at SET NOT NULL;
DROP INDEX invitations_one_unrevoked_per_apartment;
CREATE UNIQUE INDEX invitations_one_active_per_apartment
  ON invitations (apartment_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

CREATE TABLE apartment_access_grants (
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
CREATE UNIQUE INDEX apartment_access_grants_one_active_per_resident
  ON apartment_access_grants (apartment_id, resident_id)
  WHERE revoked_at IS NULL;
CREATE INDEX apartment_access_grants_by_owner
  ON apartment_access_grants (granted_by_membership_id, created_at DESC)
  WHERE revoked_at IS NULL;

