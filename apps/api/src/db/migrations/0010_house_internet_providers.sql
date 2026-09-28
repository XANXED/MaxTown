ALTER TABLE house_service_tariffs
  ADD COLUMN tariff_name text NOT NULL DEFAULT 'Тариф'
    CHECK (length(btrim(tariff_name)) BETWEEN 1 AND 160),
  ADD COLUMN speed_mbps integer CHECK (speed_mbps IS NULL OR speed_mbps > 0),
  ADD COLUMN promo_amount numeric(12, 2) CHECK (promo_amount IS NULL OR promo_amount >= 0),
  ADD COLUMN promo_months integer CHECK (promo_months IS NULL OR promo_months > 0),
  ADD COLUMN technology text CHECK (technology IS NULL OR technology IN ('fttb', 'gpon', 'docsis', 'xdsl', 'wireless', 'other')),
  ADD COLUMN has_tv boolean NOT NULL DEFAULT false;

CREATE TABLE house_internet_provider_ratings (
  service_id uuid NOT NULL,
  house_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, membership_id),
  FOREIGN KEY (service_id, house_id) REFERENCES house_services(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, house_id) REFERENCES memberships(id, house_id)
);

CREATE INDEX house_internet_provider_ratings_house_service
  ON house_internet_provider_ratings (house_id, service_id);
