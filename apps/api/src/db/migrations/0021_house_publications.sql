-- Плановые отключения и Объявления Дома. Аварии остаются в accidents:
-- у них отдельный жизненный цикл с подтверждениями Жильцов и Заявками.
CREATE TABLE house_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('planned-outage', 'announcement')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  scope text CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 120),
  systems text[] NOT NULL DEFAULT '{}' CHECK (
    systems <@ ARRAY['Электричество', 'Вода', 'Отопление', 'Лифты', 'Интернет']::text[]
    AND cardinality(systems) <= 5
  ),
  advice text[] NOT NULL DEFAULT '{}' CHECK (cardinality(advice) <= 10),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  published_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  cancelled_at timestamptz,
  FOREIGN KEY (published_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (kind = 'planned-outage' AND cardinality(systems) > 0 AND ends_at IS NOT NULL)
    OR (kind = 'announcement' AND cardinality(systems) = 0)
  )
);

CREATE INDEX house_publications_house_time
  ON house_publications (house_id, starts_at DESC)
  WHERE cancelled_at IS NULL;
