ALTER TABLE house_services
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'partner-feed', 'operator-api', 'gis-zhkh')),
  ADD COLUMN source_external_id text,
  ADD COLUMN source_checked_at timestamptz,
  ADD COLUMN manual_override boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX house_internet_provider_source_external_key
  ON house_services (house_id, source, source_external_id)
  WHERE category = 'internet' AND source_external_id IS NOT NULL;

CREATE TABLE house_internet_provider_syncs (
  house_id uuid PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('partner-feed', 'operator-api', 'gis-zhkh')),
  status text NOT NULL DEFAULT 'not-configured'
    CHECK (status IN ('not-configured', 'ready', 'running', 'failed')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
