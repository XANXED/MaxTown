-- Квартирный ремонт живёт отдельно от общедомовых repair_modes.
-- Смежность вычисляется по четырём соседним ячейкам внутренней сетки.

ALTER TABLE apartments
  ADD COLUMN entrance integer,
  ADD COLUMN floor integer,
  ADD COLUMN layout_column integer,
  ADD COLUMN layout_updated_by_membership_id uuid,
  ADD COLUMN layout_updated_at timestamptz,
  ADD CONSTRAINT apartments_layout_complete CHECK (
    (entrance IS NULL AND floor IS NULL AND layout_column IS NULL)
    OR (entrance IS NOT NULL AND floor IS NOT NULL AND layout_column IS NOT NULL
      AND entrance >= 1 AND floor >= 1 AND layout_column BETWEEN -100 AND 100)
  ),
  ADD FOREIGN KEY (layout_updated_by_membership_id, house_id) REFERENCES memberships(id, house_id);

CREATE UNIQUE INDEX apartments_layout_cell
  ON apartments (house_id, entrance, floor, layout_column)
  WHERE entrance IS NOT NULL;

CREATE TABLE apartment_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  work_types text[] NOT NULL,
  details text CHECK (details IS NULL OR length(details) BETWEEN 1 AND 2000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id),
  CHECK (ends_at > starts_at),
  CHECK (cardinality(work_types) BETWEEN 1 AND 8),
  CHECK (work_types <@ ARRAY['demolition', 'drilling', 'flooring', 'plumbing', 'electrical', 'finishing', 'furniture', 'other']::text[]),
  CHECK (completed_at IS NULL OR cancelled_at IS NULL)
);

CREATE INDEX apartment_repairs_house_time ON apartment_repairs (house_id, starts_at DESC);
CREATE INDEX apartment_repairs_apartment_open ON apartment_repairs (apartment_id, ends_at)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check,
  DROP CONSTRAINT IF EXISTS in_app_notifications_target_check,
  ADD COLUMN apartment_repair_id uuid,
  ADD COLUMN apartment_repair_version integer,
  ADD FOREIGN KEY (apartment_repair_id, house_id) REFERENCES apartment_repairs(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT in_app_notifications_kind_check CHECK (
    kind IN ('community-poll', 'request-new', 'request-status', 'request-comment', 'request-visit', 'accident', 'apartment-repair')
  ),
  ADD CONSTRAINT in_app_notifications_target_check CHECK (
    (kind = 'community-poll' AND poll_id IS NOT NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND apartment_repair_version IS NULL)
    OR (kind IN ('request-new', 'request-status', 'request-comment', 'request-visit')
      AND poll_id IS NULL AND request_id IS NOT NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND apartment_repair_version IS NULL AND title IS NOT NULL)
    OR (kind = 'accident' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NOT NULL
      AND apartment_repair_id IS NULL AND apartment_repair_version IS NULL AND title IS NOT NULL)
    OR (kind = 'apartment-repair' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NOT NULL AND apartment_repair_version >= 1 AND title IS NOT NULL)
  );

CREATE UNIQUE INDEX in_app_notifications_apartment_repair_version
  ON in_app_notifications (resident_id, apartment_repair_id, apartment_repair_version)
  WHERE apartment_repair_id IS NOT NULL;

CREATE TABLE max_direct_message_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_repair_id uuid NOT NULL,
  apartment_repair_version integer NOT NULL CHECK (apartment_repair_version >= 1),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  max_user_id bigint NOT NULL CHECK (max_user_id > 0),
  event_kind text NOT NULL CHECK (event_kind IN ('created', 'updated', 'cancelled', 'completed')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (apartment_repair_id, house_id) REFERENCES apartment_repairs(id, house_id) ON DELETE CASCADE,
  UNIQUE (apartment_repair_id, apartment_repair_version, resident_id)
);

CREATE INDEX max_direct_message_outbox_due
  ON max_direct_message_outbox (next_attempt_at, id) WHERE status = 'pending';
