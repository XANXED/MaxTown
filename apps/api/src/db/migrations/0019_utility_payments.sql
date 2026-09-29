-- Ручной контроль Платежей ЖКУ внутри одной Квартиры (docs/adr/0015).

CREATE TABLE utility_payment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'rent', 'electricity', 'gas', 'water', 'heating', 'capital-repair', 'intercom', 'internet', 'other'
  )),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  due_day smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  starts_on date NOT NULL CHECK (starts_on = date_trunc('month', starts_on)::date),
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
CREATE INDEX utility_payment_templates_apartment
  ON utility_payment_templates (apartment_id, archived_at, starts_on, id);

CREATE TABLE utility_payment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES utility_payment_templates(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  billing_month date NOT NULL CHECK (billing_month = date_trunc('month', billing_month)::date),
  category text NOT NULL CHECK (category IN (
    'rent', 'electricity', 'gas', 'water', 'heating', 'capital-repair', 'intercom', 'internet', 'other'
  )),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  due_on date NOT NULL,
  paid_at timestamptz,
  paid_by_membership_id uuid,
  skipped_at timestamptz,
  skipped_by_membership_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  FOREIGN KEY (skipped_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (template_id, billing_month),
  UNIQUE (id, house_id),
  CHECK ((paid_at IS NULL) = (paid_by_membership_id IS NULL)),
  CHECK ((skipped_at IS NULL) = (skipped_by_membership_id IS NULL)),
  CHECK (paid_at IS NULL OR skipped_at IS NULL)
);
CREATE INDEX utility_payment_periods_apartment_month
  ON utility_payment_periods (apartment_id, billing_month DESC, due_on, id);
CREATE INDEX utility_payment_periods_pending_due
  ON utility_payment_periods (due_on, id) WHERE paid_at IS NULL AND skipped_at IS NULL;

CREATE TABLE utility_payment_receipts (
  period_id uuid PRIMARY KEY REFERENCES utility_payment_periods(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 5242880),
  uploaded_by_membership_id uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, house_id) REFERENCES utility_payment_periods(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_membership_id, house_id) REFERENCES memberships(id, house_id)
);

CREATE TABLE utility_payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  template_id uuid REFERENCES utility_payment_templates(id) ON DELETE CASCADE,
  period_id uuid REFERENCES utility_payment_periods(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'template-created', 'template-updated', 'template-archived', 'period-updated',
    'paid', 'unpaid', 'skipped', 'unskipped', 'receipt-added', 'receipt-replaced', 'receipt-deleted'
  )),
  actor_membership_id uuid NOT NULL,
  actor_name text NOT NULL CHECK (length(actor_name) BETWEEN 1 AND 200),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_membership_id, house_id) REFERENCES memberships(id, house_id),
  CHECK (template_id IS NOT NULL OR period_id IS NOT NULL)
);
CREATE INDEX utility_payment_events_period ON utility_payment_events (period_id, id);

ALTER TABLE in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check,
  DROP CONSTRAINT IF EXISTS in_app_notifications_target_check,
  ADD COLUMN utility_payment_period_id uuid,
  ADD COLUMN utility_payment_reminder_type text,
  ADD FOREIGN KEY (utility_payment_period_id, house_id)
    REFERENCES utility_payment_periods(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT in_app_notifications_kind_check CHECK (
    kind IN ('community-poll', 'request-new', 'request-status', 'request-comment', 'request-visit',
             'accident', 'apartment-repair', 'management-question', 'management-answer', 'utility-payment')
  ),
  ADD CONSTRAINT in_app_notifications_target_check CHECK (
    (kind = 'community-poll' AND poll_id IS NOT NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL)
    OR (kind IN ('request-new', 'request-status', 'request-comment', 'request-visit')
      AND poll_id IS NULL AND request_id IS NOT NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL AND title IS NOT NULL)
    OR (kind = 'accident' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NOT NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL AND title IS NOT NULL)
    OR (kind = 'apartment-repair' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NOT NULL AND apartment_repair_version >= 1
      AND management_question_id IS NULL AND utility_payment_period_id IS NULL AND title IS NOT NULL)
    OR (kind IN ('management-question', 'management-answer')
      AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL AND apartment_repair_id IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL
      AND utility_payment_period_id IS NULL AND title IS NOT NULL)
    OR (kind = 'utility-payment' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL
      AND utility_payment_period_id IS NOT NULL
      AND utility_payment_reminder_type IN ('three-days', 'due-today', 'overdue-once') AND title IS NOT NULL)
  );
CREATE UNIQUE INDEX in_app_notifications_utility_payment_reminder
  ON in_app_notifications (resident_id, utility_payment_period_id, utility_payment_reminder_type)
  WHERE utility_payment_period_id IS NOT NULL;

ALTER TABLE max_direct_message_outbox
  DROP CONSTRAINT IF EXISTS max_direct_message_outbox_target_check,
  DROP CONSTRAINT IF EXISTS max_direct_message_outbox_event_kind_check,
  ADD COLUMN utility_payment_period_id uuid,
  ADD COLUMN utility_payment_reminder_type text,
  ADD FOREIGN KEY (utility_payment_period_id, house_id)
    REFERENCES utility_payment_periods(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT max_direct_message_outbox_target_check CHECK (
    (apartment_repair_id IS NOT NULL AND apartment_repair_version IS NOT NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL
      AND utility_payment_period_id IS NULL)
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL
      AND utility_payment_period_id IS NULL)
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL
      AND utility_payment_period_id IS NOT NULL
      AND utility_payment_reminder_type IN ('three-days', 'due-today', 'overdue-once'))
  ),
  ADD CONSTRAINT max_direct_message_outbox_event_kind_check CHECK (
    event_kind IN ('created', 'updated', 'cancelled', 'completed', 'question', 'follow-up', 'answer', 'catch-up', 'payment-reminder')
  );
