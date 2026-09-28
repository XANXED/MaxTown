CREATE TABLE resident_message_permissions (
  resident_id uuid PRIMARY KEY REFERENCES residents(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('allowed', 'denied', 'opted_out')),
  consented_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'allowed' OR consented_at IS NOT NULL)
);

CREATE TABLE vk_callback_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
  event_type text NOT NULL,
  group_id bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  house_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (poll_id, house_id) REFERENCES polls(id, house_id) ON DELETE CASCADE,
  UNIQUE (resident_id, poll_id)
);

CREATE INDEX in_app_notifications_resident_created ON in_app_notifications (resident_id, created_at DESC);

CREATE TABLE vk_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL,
  house_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  vk_user_id text NOT NULL,
  provider_random_id integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'denied', 'failed')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (poll_id, house_id) REFERENCES polls(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, house_id) REFERENCES memberships(id, house_id) ON DELETE CASCADE,
  UNIQUE (poll_id, membership_id)
);

CREATE INDEX vk_notification_outbox_pending ON vk_notification_outbox (available_at, id) WHERE status IN ('pending', 'processing');
