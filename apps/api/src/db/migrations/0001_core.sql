CREATE TABLE residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_user_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  username text,
  phone text,
  phone_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text NOT NULL,
  locality text NOT NULL,
  gar_house_guid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address, locality)
);

CREATE TABLE apartments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_id, number),
  UNIQUE (id, house_id)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('headman', 'responsible', 'concierge', 'resident')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id),
  CHECK (role NOT IN ('headman', 'resident') OR apartment_id IS NOT NULL),
  UNIQUE (id, house_id)
);
CREATE UNIQUE INDEX memberships_one_active_role_per_house
  ON memberships (resident_id, house_id)
  WHERE ended_at IS NULL;

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  apartment_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  code_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_membership_id, house_id) REFERENCES memberships(id, house_id)
);
CREATE UNIQUE INDEX invitations_one_unrevoked_per_apartment
  ON invitations (apartment_id)
  WHERE revoked_at IS NULL;

CREATE TABLE join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  apartment_id uuid NOT NULL,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_membership_id uuid,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);
CREATE UNIQUE INDEX join_requests_one_pending_per_resident_apartment
  ON join_requests (resident_id, apartment_id)
  WHERE status = 'pending';

CREATE TABLE moderators (
  principal text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE house_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by_resident_id uuid NOT NULL REFERENCES residents(id),
  address text NOT NULL,
  locality text NOT NULL,
  gar_house_guid text,
  apartment_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_principal text REFERENCES moderators(principal),
  rejection_reason text,
  house_id uuid UNIQUE REFERENCES houses(id),
  CHECK ((status = 'pending' AND decided_at IS NULL AND house_id IS NULL) OR status <> 'pending'),
  CHECK (status <> 'approved' OR house_id IS NOT NULL),
  CHECK ((status <> 'rejected') OR rejection_reason IS NOT NULL)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_resident_expiry ON sessions (resident_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE community_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (author_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);
CREATE INDEX community_messages_house_created ON community_messages (house_id, created_at DESC, id DESC);

CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (author_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);

CREATE TABLE poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  position smallint NOT NULL CHECK (position > 0),
  UNIQUE (poll_id, position),
  UNIQUE (id, poll_id)
);

CREATE TABLE poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  option_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (poll_id, house_id) REFERENCES polls(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (option_id, poll_id) REFERENCES poll_options(id, poll_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (poll_id, membership_id)
);

CREATE TABLE repair_modes (
  house_id uuid PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  title text,
  description text,
  starts_at timestamptz,
  expected_completion_at timestamptz,
  instructions text,
  updated_by_membership_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (updated_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  CHECK (NOT is_active OR (title IS NOT NULL AND description IS NOT NULL AND starts_at IS NOT NULL))
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  actor_membership_id uuid NOT NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_membership_id, house_id) REFERENCES memberships(id, house_id)
);
CREATE INDEX audit_events_house_time ON audit_events (house_id, occurred_at DESC);
