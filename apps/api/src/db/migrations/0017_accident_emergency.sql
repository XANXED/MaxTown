-- Режим ЧС (docs/adr/0012): у открытой Аварии — статус работ, срок и
-- подтверждения Жильцов «У меня тоже» на самой Аварии.
ALTER TABLE accidents
  ADD COLUMN work_status text NOT NULL DEFAULT 'repairing' CHECK (work_status IN ('checking', 'repairing')),
  -- Срок переносили: Жильцы видят «Новый срок».
  ADD COLUMN deadline_revised boolean NOT NULL DEFAULT false;

-- Аварии, которые открыл Порог, ещё проверяют.
UPDATE accidents SET work_status = 'checking' WHERE opened_by_membership_id IS NULL;

-- «У меня тоже» на Аварии: Жилец подтверждает проблему без своей Заявки.
CREATE TABLE accident_confirmations (
  accident_id uuid NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (accident_id, resident_id)
);
CREATE INDEX accident_confirmations_resident ON accident_confirmations (resident_id);
