-- Приватные Приборы учёта и Показания одной Квартиры (docs/adr/0016).

CREATE TABLE utility_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'cold-water', 'hot-water', 'electricity-day', 'electricity-night', 'heat'
  )),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  serial text CHECK (serial IS NULL OR length(serial) BETWEEN 1 AND 80),
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 3),
  created_by_membership_id uuid NOT NULL,
  updated_by_membership_id uuid NOT NULL,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  FOREIGN KEY (updated_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);
CREATE INDEX utility_meters_apartment
  ON utility_meters (apartment_id, archived_at, created_at, id);
CREATE UNIQUE INDEX utility_meters_active_serial_kind
  ON utility_meters (apartment_id, serial, kind)
  WHERE archived_at IS NULL AND serial IS NOT NULL;

CREATE TABLE utility_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id uuid NOT NULL,
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  reading_month date NOT NULL CHECK (reading_month = date_trunc('month', reading_month)::date),
  value numeric(18, 3) NOT NULL CHECK (value >= 0),
  submitted_by_membership_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (meter_id, house_id) REFERENCES utility_meters(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (meter_id, reading_month)
);
CREATE INDEX utility_meter_readings_apartment_month
  ON utility_meter_readings (apartment_id, reading_month DESC, meter_id);
