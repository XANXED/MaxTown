CREATE TABLE house_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'management', 'dispatch', 'house-emergency', 'plumber', 'electrician',
    'elevator', 'intercom', 'security', 'district-police', 'other'
  )),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  phone text CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 1 AND 80),
  link text CHECK (link IS NULL OR (length(btrim(link)) BETWEEN 1 AND 500 AND link ~ '^https://')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'data-mos')),
  source_key text,
  source_checked_at timestamptz,
  overridden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR link IS NOT NULL),
  CHECK (
    (source = 'manual' AND source_key IS NULL)
    OR (source = 'data-mos' AND source_key IS NOT NULL AND source_checked_at IS NOT NULL)
  ),
  UNIQUE (id, house_id)
);

CREATE INDEX house_contacts_house_kind
  ON house_contacts (house_id, kind, title)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX house_contacts_external_key
  ON house_contacts (house_id, source, source_key)
  WHERE source_key IS NOT NULL;

CREATE TABLE house_contact_syncs (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source = 'data-mos'),
  status text NOT NULL CHECK (status IN ('ready', 'not-found', 'ambiguous', 'failed', 'not-configured', 'not-applicable')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  PRIMARY KEY (house_id, source)
);
