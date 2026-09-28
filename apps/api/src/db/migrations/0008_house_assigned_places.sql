-- Закреплённые места (CONTEXT.md, docs/adr/0003): места, за которыми Дом
-- закреплён по адресу. Ведёт Староста; данные наши, поэтому храним.
-- Ближайшие места из 2ГИС здесь не хранятся — это запрещают правила 2ГИС.
CREATE TABLE house_assigned_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'adult-clinic', 'children-clinic', 'womens-clinic', 'school', 'kindergarten',
    'polling-station', 'magistrate', 'police-precinct', 'military-office', 'other'
  )),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 1 AND 300),
  hours text CHECK (hours IS NULL OR length(btrim(hours)) BETWEEN 1 AND 200),
  phone text CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 1 AND 80),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX house_assigned_places_house_kind
  ON house_assigned_places (house_id, kind, title)
  WHERE deleted_at IS NULL;
