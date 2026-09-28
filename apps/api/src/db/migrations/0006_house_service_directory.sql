CREATE TABLE house_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('internet', 'telecom', 'utilities', 'maintenance', 'other')),
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 160),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  state text NOT NULL CHECK (state IN ('available', 'limited', 'unavailable', 'discontinued')),
  contacts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contacts) = 'object'),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, house_id)
);

CREATE INDEX house_services_house_category ON house_services (house_id, category, provider);

CREATE TABLE house_service_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  house_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_period text NOT NULL CHECK (length(btrim(billing_period)) BETWEEN 1 AND 80),
  conditions text NOT NULL DEFAULT '' CHECK (length(conditions) <= 2000),
  starts_on date NOT NULL,
  ends_on date,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 1000),
  checked_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (service_id, house_id) REFERENCES house_services(id, house_id) ON DELETE CASCADE,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  UNIQUE (id, service_id)
);

CREATE INDEX house_service_tariffs_service_dates ON house_service_tariffs (service_id, starts_on DESC, ends_on);
