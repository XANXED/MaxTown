-- Заявки, «У меня тоже», Аварии и Порог (docs/adr/0012). Заявки обрабатывают
-- УК и Администратор Дома; Заявки об Общем имуществе видят все Жильцы Дома.

-- Номер Заявки внутри Дома: «Заявка № 12». Создание Заявки блокирует строку
-- Дома, поэтому номера и проверка Порога идут по очереди.
ALTER TABLE houses
  ADD COLUMN next_request_number integer NOT NULL DEFAULT 1 CHECK (next_request_number > 0);

-- Авария: внезапная неисправность одной Системы. Открывает УК, Администратор
-- Дома или Порог (opened_by_membership_id IS NULL).
CREATE TABLE accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  system text NOT NULL CHECK (system IN ('Электричество', 'Вода', 'Отопление', 'Лифты', 'Интернет')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  scope text CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 120),
  advice text[] NOT NULL DEFAULT '{}' CHECK (cardinality(advice) <= 10),
  opened_by_membership_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  expected_resolution_at timestamptz,
  resolved_at timestamptz,
  resolved_by_membership_id uuid,
  FOREIGN KEY (opened_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  FOREIGN KEY (resolved_by_membership_id, house_id) REFERENCES memberships(id, house_id),
  UNIQUE (id, house_id)
);
-- По одной Системе открыта не больше одной Аварии.
CREATE UNIQUE INDEX accidents_one_open_per_system ON accidents (house_id, system) WHERE resolved_at IS NULL;
CREATE INDEX accidents_house_opened ON accidents (house_id, opened_at DESC);

-- Заявка. Автор — по residents: членство заканчивается при выходе из чата,
-- а Заявки человека остаются его. Доступ проверяется по текущему членству.
CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number > 0),
  author_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'Электричество', 'Вода', 'Отопление', 'Лифты', 'Интернет', 'Сантехника', 'Домофон', 'Уборка', 'Другое'
  )),
  place text NOT NULL CHECK (place IN ('apartment', 'common-property')),
  apartment_number text CHECK (apartment_number IS NULL OR length(apartment_number) BETWEEN 1 AND 10),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 500),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'done', 'closed', 'rejected', 'cancelled')),
  preferred_visit_date date,
  visit_scheduled_at timestamptz,
  responsible_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  accident_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Когда Ответственный сообщил об исправлении и когда напомнили Жильцу.
  done_at timestamptz,
  reminded_at timestamptz,
  FOREIGN KEY (accident_id, house_id) REFERENCES accidents(id, house_id),
  UNIQUE (house_id, number),
  UNIQUE (id, house_id),
  CHECK (place = 'common-property' OR apartment_number IS NOT NULL),
  CHECK (place = 'apartment' OR (apartment_number IS NULL AND preferred_visit_date IS NULL AND visit_scheduled_at IS NULL)),
  CHECK (status <> 'done' OR done_at IS NOT NULL)
);
CREATE INDEX requests_house_status ON requests (house_id, status, place, updated_at DESC);
CREATE INDEX requests_author ON requests (author_resident_id, updated_at DESC);
CREATE INDEX requests_accident ON requests (accident_id) WHERE accident_id IS NOT NULL;
CREATE INDEX requests_awaiting_resident ON requests (done_at) WHERE status = 'done';

-- «У меня тоже»: сосед столкнулся с той же проблемой в Общем имуществе.
-- Отметки считаются в Порог и подписывают соседа на ход Заявки.
CREATE TABLE request_supporters (
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, resident_id)
);
CREATE INDEX request_supporters_resident ON request_supporters (resident_id);

-- Ход Заявки. actor_resident_id IS NULL — статус сменила система:
-- автозакрытие или закрытие Аварии.
CREATE TABLE request_status_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('new', 'in-progress', 'done', 'closed', 'rejected', 'cancelled')),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 1000),
  actor_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_status_changes_request ON request_status_changes (request_id, id);

-- Комментарии пишут автор (resident) и Ответственные (responsible).
CREATE TABLE request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('resident', 'responsible')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_comments_request ON request_comments (request_id, seq);

-- Фото к Заявке: телефон сжимает их до 1600 px, здесь — не больше 1,5 МБ.
CREATE TABLE request_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1572864),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, position)
);

-- Уведомления в мини-аппе теперь не только об Опросах: о Заявках и Авариях.
-- Заголовок и текст пишутся при создании: время в них не подставляется,
-- подписи со временем собирает клиент.
ALTER TABLE in_app_notifications
  ALTER COLUMN poll_id DROP NOT NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'community-poll'
    CHECK (kind IN ('community-poll', 'request-new', 'request-status', 'request-comment', 'request-visit', 'accident')),
  ADD COLUMN request_id uuid,
  ADD COLUMN accident_id uuid,
  ADD COLUMN title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
  ADD COLUMN body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 1000),
  ADD FOREIGN KEY (request_id, house_id) REFERENCES requests(id, house_id) ON DELETE CASCADE,
  ADD FOREIGN KEY (accident_id, house_id) REFERENCES accidents(id, house_id) ON DELETE CASCADE,
  ADD CONSTRAINT in_app_notifications_target_check CHECK (
    (kind = 'community-poll' AND poll_id IS NOT NULL AND request_id IS NULL AND accident_id IS NULL)
    OR (kind IN ('request-new', 'request-status', 'request-comment', 'request-visit')
        AND poll_id IS NULL AND request_id IS NOT NULL AND title IS NOT NULL)
    OR (kind = 'accident' AND poll_id IS NULL AND accident_id IS NOT NULL AND title IS NOT NULL)
  );
