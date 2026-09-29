-- Публичная Приёмная УК (docs/adr/0014). Вопросы не являются Заявками и не
-- влияют на Состояние дома.

CREATE TABLE management_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  author_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  state text NOT NULL DEFAULT 'waiting-for-answer'
    CHECK (state IN ('waiting-for-answer', 'answered', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (id, house_id),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX management_questions_house_state
  ON management_questions (house_id, state, updated_at DESC, id DESC);

CREATE TABLE management_question_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  question_id uuid NOT NULL REFERENCES management_questions(id) ON DELETE CASCADE,
  author_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('resident', 'admin', 'management-company')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, question_id)
);
CREATE INDEX management_question_messages_question
  ON management_question_messages (question_id, seq);

CREATE TABLE management_question_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  message_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1572864),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (message_id, question_id) REFERENCES management_question_messages(id, question_id) ON DELETE CASCADE,
  UNIQUE (message_id, position)
);

CREATE TABLE management_question_state_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES management_questions(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('waiting-for-answer', 'answered', 'closed')),
  actor_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_question_state_changes_question
  ON management_question_state_changes (question_id, id);

ALTER TABLE in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check,
  DROP CONSTRAINT IF EXISTS in_app_notifications_target_check,
  ADD COLUMN management_question_id uuid,
  ADD COLUMN management_question_message_id uuid,
  ADD FOREIGN KEY (management_question_id, house_id)
    REFERENCES management_questions(id, house_id) ON DELETE CASCADE,
  ADD FOREIGN KEY (management_question_message_id, management_question_id)
    REFERENCES management_question_messages(id, question_id) ON DELETE CASCADE,
  ADD CONSTRAINT in_app_notifications_kind_check CHECK (
    kind IN ('community-poll', 'request-new', 'request-status', 'request-comment', 'request-visit',
             'accident', 'apartment-repair', 'management-question', 'management-answer')
  ),
  ADD CONSTRAINT in_app_notifications_target_check CHECK (
    (kind = 'community-poll' AND poll_id IS NOT NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL)
    OR (kind IN ('request-new', 'request-status', 'request-comment', 'request-visit')
      AND poll_id IS NULL AND request_id IS NOT NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND title IS NOT NULL)
    OR (kind = 'accident' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NOT NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND title IS NOT NULL)
    OR (kind = 'apartment-repair' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NOT NULL AND apartment_repair_version >= 1
      AND management_question_id IS NULL AND title IS NOT NULL)
    OR (kind IN ('management-question', 'management-answer')
      AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL AND apartment_repair_id IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL AND title IS NOT NULL)
  );

CREATE UNIQUE INDEX in_app_notifications_management_question_message
  ON in_app_notifications (resident_id, kind, management_question_message_id)
  WHERE management_question_message_id IS NOT NULL;

-- Общий outbox принимает готовую кнопку и payload. Старые записи Ремонта
-- Квартиры получают те же значения, которые раньше собирал worker.
ALTER TABLE max_direct_message_outbox
  DROP CONSTRAINT IF EXISTS max_direct_message_outbox_event_kind_check,
  ALTER COLUMN resident_id DROP NOT NULL,
  ALTER COLUMN apartment_repair_id DROP NOT NULL,
  ALTER COLUMN apartment_repair_version DROP NOT NULL,
  ADD COLUMN management_question_id uuid,
  ADD COLUMN management_question_message_id uuid,
  ADD COLUMN button_text text,
  ADD COLUMN button_payload text,
  ADD COLUMN dedupe_key text,
  ADD FOREIGN KEY (management_question_id, house_id)
    REFERENCES management_questions(id, house_id) ON DELETE CASCADE,
  ADD FOREIGN KEY (management_question_message_id, management_question_id)
    REFERENCES management_question_messages(id, question_id) ON DELETE CASCADE;

UPDATE max_direct_message_outbox
   SET button_text = 'Открыть ремонт',
       button_payload = 'repair_' || house_id || '_' || apartment_repair_id,
       dedupe_key = 'repair:' || apartment_repair_id || ':' || apartment_repair_version || ':' || max_user_id;

ALTER TABLE max_direct_message_outbox
  ALTER COLUMN button_text SET NOT NULL,
  ALTER COLUMN button_payload SET NOT NULL,
  ALTER COLUMN dedupe_key SET NOT NULL,
  ADD CONSTRAINT max_direct_message_outbox_target_check CHECK (
    (apartment_repair_id IS NOT NULL AND apartment_repair_version IS NOT NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL)
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL)
  ),
  ADD CONSTRAINT max_direct_message_outbox_event_kind_check CHECK (
    event_kind IN ('created', 'updated', 'cancelled', 'completed', 'question', 'follow-up', 'answer', 'catch-up')
  ),
  ADD CONSTRAINT max_direct_message_outbox_button_text_check CHECK (length(button_text) BETWEEN 1 AND 64),
  ADD CONSTRAINT max_direct_message_outbox_button_payload_check CHECK (length(button_payload) BETWEEN 1 AND 256),
  ADD CONSTRAINT max_direct_message_outbox_dedupe_key_check CHECK (length(dedupe_key) BETWEEN 1 AND 500);

CREATE UNIQUE INDEX max_direct_message_outbox_dedupe ON max_direct_message_outbox (dedupe_key);
