-- Защищённая привязка к Квартире и приватная граница платёжных данных.
-- Квартира хранит техническую историю, Домохозяйство — данные непрерывного
-- состава её Жильцов (docs/adr/0018).

CREATE TABLE apartment_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY (apartment_id, house_id) REFERENCES apartments(id, house_id) ON DELETE CASCADE,
  UNIQUE (id, house_id, apartment_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX apartment_households_one_active_per_apartment
  ON apartment_households (apartment_id) WHERE ended_at IS NULL;
CREATE INDEX apartment_households_apartment_history
  ON apartment_households (apartment_id, started_at DESC, id DESC);

-- Для каждой занятой Квартиры и каждой Квартиры со старыми Платежами создаём
-- единственное исходное Домохозяйство. У пустой Квартиры оно сразу закрыто.
WITH relevant_apartments AS (
  SELECT apartment_id FROM memberships
   WHERE apartment_id IS NOT NULL AND role IN ('resident', 'admin')
  UNION
  SELECT apartment_id FROM utility_payment_templates
  UNION
  SELECT apartment_id FROM utility_payment_periods
  UNION
  SELECT apartment_id FROM utility_payment_events
), occupants AS (
  SELECT apartment_id,
         min(created_at) AS first_joined_at,
         bool_or(ended_at IS NULL AND role IN ('resident', 'admin')) AS occupied
    FROM memberships
   WHERE apartment_id IS NOT NULL AND role IN ('resident', 'admin')
   GROUP BY apartment_id
)
INSERT INTO apartment_households (house_id, apartment_id, started_at, ended_at)
SELECT apartment.house_id,
       apartment.id,
       COALESCE(occupants.first_joined_at, apartment.created_at),
       CASE WHEN COALESCE(occupants.occupied, false) THEN NULL ELSE now() END
  FROM relevant_apartments relevant
  JOIN apartments apartment ON apartment.id = relevant.apartment_id
  LEFT JOIN occupants ON occupants.apartment_id = apartment.id;

ALTER TABLE memberships
  ADD COLUMN apartment_household_id uuid,
  ADD CONSTRAINT memberships_apartment_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id),
  ADD CONSTRAINT memberships_apartment_household_location CHECK (
    apartment_household_id IS NULL OR apartment_id IS NOT NULL
  );

UPDATE memberships membership
   SET apartment_household_id = household.id
  FROM apartment_households household
 WHERE membership.apartment_id = household.apartment_id
   AND membership.house_id = household.house_id
   AND membership.role IN ('resident', 'admin')
   AND (
     (membership.ended_at IS NULL AND household.ended_at IS NULL)
     OR (membership.ended_at IS NOT NULL AND household.started_at <= membership.ended_at)
   );

ALTER TABLE utility_payment_templates ADD COLUMN apartment_household_id uuid;
ALTER TABLE utility_payment_periods ADD COLUMN apartment_household_id uuid;
ALTER TABLE utility_payment_events ADD COLUMN apartment_household_id uuid;

UPDATE utility_payment_templates payment
   SET apartment_household_id = household.id
  FROM apartment_households household
 WHERE payment.house_id = household.house_id AND payment.apartment_id = household.apartment_id;
UPDATE utility_payment_periods payment
   SET apartment_household_id = household.id
  FROM apartment_households household
 WHERE payment.house_id = household.house_id AND payment.apartment_id = household.apartment_id;
UPDATE utility_payment_events payment
   SET apartment_household_id = household.id
  FROM apartment_households household
 WHERE payment.house_id = household.house_id AND payment.apartment_id = household.apartment_id;

ALTER TABLE utility_payment_templates
  ALTER COLUMN apartment_household_id SET NOT NULL,
  ADD CONSTRAINT utility_payment_templates_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id);
ALTER TABLE utility_payment_periods
  ALTER COLUMN apartment_household_id SET NOT NULL,
  ADD CONSTRAINT utility_payment_periods_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id);
ALTER TABLE utility_payment_events
  ALTER COLUMN apartment_household_id SET NOT NULL,
  ADD CONSTRAINT utility_payment_events_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id);

CREATE INDEX utility_payment_templates_household
  ON utility_payment_templates (apartment_household_id, archived_at, starts_on, id);
CREATE INDEX utility_payment_periods_household_month
  ON utility_payment_periods (apartment_household_id, billing_month DESC, due_on, id);

ALTER TABLE invitations
  ADD COLUMN apartment_household_id uuid,
  ADD CONSTRAINT invitations_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id);

-- Старые ссылки не были привязаны к конкретному составу Квартиры.
UPDATE invitations SET revoked_at = now() WHERE revoked_at IS NULL;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_active_household_required CHECK (
    revoked_at IS NOT NULL OR apartment_household_id IS NOT NULL
  );

ALTER TABLE join_requests
  ADD COLUMN apartment_household_id uuid,
  ADD CONSTRAINT join_requests_household_fk
    FOREIGN KEY (apartment_household_id, house_id, apartment_id)
    REFERENCES apartment_households(id, house_id, apartment_id);

-- Старые Запросы могли быть созданы человеком вне Домового чата.
UPDATE join_requests
   SET status = 'rejected', decided_at = now()
 WHERE status = 'pending';

ALTER TABLE join_requests
  ADD CONSTRAINT join_requests_pending_household_required CHECK (
    status <> 'pending' OR apartment_household_id IS NOT NULL
  );

-- Этаж обязателен для новой привязки, но исторические Квартиры могут быть без
-- расположения. Этаж допустим без подъезда; колонка требует полную ячейку.
ALTER TABLE apartments DROP CONSTRAINT IF EXISTS apartments_layout_complete;
ALTER TABLE apartments
  ADD CONSTRAINT apartments_layout_complete CHECK (
    (floor IS NULL OR floor BETWEEN 1 AND 200)
    AND (entrance IS NULL OR (entrance BETWEEN 1 AND 100 AND floor IS NOT NULL))
    AND (layout_column IS NULL OR (
      entrance IS NOT NULL AND floor IS NOT NULL AND layout_column BETWEEN -100 AND 100
    ))
  );
DROP INDEX IF EXISTS apartments_layout_cell;
CREATE UNIQUE INDEX apartments_layout_cell
  ON apartments (house_id, entrance, floor, layout_column)
  WHERE layout_column IS NOT NULL;

ALTER TABLE in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check,
  DROP CONSTRAINT IF EXISTS in_app_notifications_target_check,
  ADD COLUMN apartment_access_request_id uuid,
  ADD FOREIGN KEY (apartment_access_request_id, house_id)
    REFERENCES join_requests(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT in_app_notifications_kind_check CHECK (
    kind IN ('community-poll', 'request-new', 'request-status', 'request-comment', 'request-visit',
             'accident', 'apartment-repair', 'management-question', 'management-answer', 'utility-payment',
             'apartment-access-request', 'apartment-access-decision')
  ),
  ADD CONSTRAINT in_app_notifications_target_check CHECK (
    (kind = 'community-poll' AND poll_id IS NOT NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL
      AND apartment_access_request_id IS NULL)
    OR (kind IN ('request-new', 'request-status', 'request-comment', 'request-visit')
      AND poll_id IS NULL AND request_id IS NOT NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL
      AND apartment_access_request_id IS NULL AND title IS NOT NULL)
    OR (kind = 'accident' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NOT NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL AND utility_payment_period_id IS NULL
      AND apartment_access_request_id IS NULL AND title IS NOT NULL)
    OR (kind = 'apartment-repair' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NOT NULL AND apartment_repair_version >= 1
      AND management_question_id IS NULL AND utility_payment_period_id IS NULL
      AND apartment_access_request_id IS NULL AND title IS NOT NULL)
    OR (kind IN ('management-question', 'management-answer')
      AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL AND apartment_repair_id IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL
      AND utility_payment_period_id IS NULL AND apartment_access_request_id IS NULL AND title IS NOT NULL)
    OR (kind = 'utility-payment' AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL
      AND apartment_repair_id IS NULL AND management_question_id IS NULL
      AND utility_payment_period_id IS NOT NULL AND apartment_access_request_id IS NULL
      AND utility_payment_reminder_type IN ('three-days', 'due-today', 'overdue-once') AND title IS NOT NULL)
    OR (kind IN ('apartment-access-request', 'apartment-access-decision')
      AND poll_id IS NULL AND request_id IS NULL AND accident_id IS NULL AND apartment_repair_id IS NULL
      AND management_question_id IS NULL AND utility_payment_period_id IS NULL
      AND apartment_access_request_id IS NOT NULL AND title IS NOT NULL)
  );

CREATE UNIQUE INDEX in_app_notifications_apartment_access_request
  ON in_app_notifications (resident_id, kind, apartment_access_request_id)
  WHERE apartment_access_request_id IS NOT NULL;

ALTER TABLE max_direct_message_outbox
  DROP CONSTRAINT IF EXISTS max_direct_message_outbox_target_check,
  DROP CONSTRAINT IF EXISTS max_direct_message_outbox_event_kind_check,
  ADD COLUMN apartment_access_request_id uuid,
  ADD FOREIGN KEY (apartment_access_request_id, house_id)
    REFERENCES join_requests(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT max_direct_message_outbox_target_check CHECK (
    (apartment_repair_id IS NOT NULL AND apartment_repair_version IS NOT NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL
      AND utility_payment_period_id IS NULL AND apartment_access_request_id IS NULL)
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NOT NULL AND management_question_message_id IS NOT NULL
      AND utility_payment_period_id IS NULL AND apartment_access_request_id IS NULL)
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL
      AND utility_payment_period_id IS NOT NULL AND apartment_access_request_id IS NULL
      AND utility_payment_reminder_type IN ('three-days', 'due-today', 'overdue-once'))
    OR (apartment_repair_id IS NULL AND apartment_repair_version IS NULL
      AND management_question_id IS NULL AND management_question_message_id IS NULL
      AND utility_payment_period_id IS NULL AND apartment_access_request_id IS NOT NULL)
  ),
  ADD CONSTRAINT max_direct_message_outbox_event_kind_check CHECK (
    event_kind IN ('created', 'updated', 'cancelled', 'completed', 'question', 'follow-up', 'answer', 'catch-up',
                   'payment-reminder', 'apartment-access-request', 'apartment-access-approved', 'apartment-access-rejected')
  );
