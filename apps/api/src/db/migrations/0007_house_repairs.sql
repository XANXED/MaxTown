CREATE TABLE house_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  location text CHECK (location IS NULL OR length(location) <= 240),
  status text NOT NULL CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
  starts_at timestamptz,
  expected_completion_at timestamptz,
  contractor_name text CHECK (contractor_name IS NULL OR length(contractor_name) <= 200),
  contractor_contact text CHECK (contractor_contact IS NULL OR length(contractor_contact) <= 300),
  resident_impact text CHECK (resident_impact IS NULL OR length(resident_impact) <= 2000),
  instructions text CHECK (instructions IS NULL OR length(instructions) <= 2000),
  created_by_membership_id uuid,
  updated_by_membership_id uuid,
  legacy_source_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (created_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  FOREIGN KEY (updated_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  CHECK (expected_completion_at IS NULL OR starts_at IS NULL OR expected_completion_at >= starts_at),
  UNIQUE (id, house_id)
);

CREATE INDEX house_repairs_house_status_schedule
  ON house_repairs (house_id, status, starts_at, created_at DESC);

INSERT INTO house_repairs (
  house_id, title, description, status, starts_at, expected_completion_at, instructions,
  created_by_membership_id, updated_by_membership_id, legacy_source_key, created_at, updated_at
)
SELECT house_id, title, description,
       CASE WHEN starts_at > now() THEN 'planned' ELSE 'in_progress' END,
       starts_at, expected_completion_at, instructions,
       updated_by_membership_id, updated_by_membership_id,
       'repair_mode:' || house_id::text, updated_at, updated_at
  FROM repair_modes
 WHERE is_active
ON CONFLICT (legacy_source_key) DO NOTHING;

INSERT INTO audit_events (house_id, actor_membership_id, event_type, details, occurred_at)
SELECT repair.house_id, repair.updated_by_membership_id, 'house_repair.migrated',
       jsonb_build_object(
         'repairId', repair.id,
         'action', 'migrated',
         'after', jsonb_build_object(
           'title', repair.title,
           'description', repair.description,
           'status', repair.status,
           'startsAt', repair.starts_at,
           'expectedCompletionAt', repair.expected_completion_at,
           'instructions', repair.instructions
         )
       ),
       repair.updated_at
  FROM house_repairs repair
 WHERE repair.legacy_source_key LIKE 'repair_mode:%'
   AND repair.updated_by_membership_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM audit_events existing
      WHERE existing.event_type = 'house_repair.migrated'
        AND existing.details ->> 'repairId' = repair.id::text
   );

INSERT INTO house_repairs (
  house_id, title, description, status, starts_at, expected_completion_at, instructions,
  created_by_membership_id, updated_by_membership_id, legacy_source_key, created_at, updated_at
)
SELECT event.house_id,
       COALESCE(NULLIF(snapshot.details -> 'before' ->> 'title', ''), NULLIF(snapshot.details -> 'after' ->> 'title', '')),
       COALESCE(NULLIF(snapshot.details -> 'before' ->> 'description', ''), NULLIF(snapshot.details -> 'after' ->> 'description', '')),
       'completed',
       COALESCE(snapshot.details -> 'before' ->> 'startsAt', snapshot.details -> 'after' ->> 'startsAt')::timestamptz,
       COALESCE(snapshot.details -> 'before' ->> 'expectedCompletionAt', snapshot.details -> 'after' ->> 'expectedCompletionAt')::timestamptz,
       COALESCE(snapshot.details -> 'before' ->> 'instructions', snapshot.details -> 'after' ->> 'instructions'),
       event.actor_membership_id, event.actor_membership_id,
       'repair_mode_event:' || event.id::text, event.occurred_at, event.occurred_at
  FROM audit_events event
 CROSS JOIN LATERAL (SELECT event.details AS details) snapshot
 WHERE event.event_type = 'repair_mode.completed'
   AND COALESCE(snapshot.details -> 'before' ->> 'title', snapshot.details -> 'after' ->> 'title') IS NOT NULL
   AND COALESCE(snapshot.details -> 'before' ->> 'description', snapshot.details -> 'after' ->> 'description') IS NOT NULL
ON CONFLICT (legacy_source_key) DO NOTHING;
