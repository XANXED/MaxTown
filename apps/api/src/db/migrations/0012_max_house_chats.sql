-- MaxTown снова работает только в MAX (docs/adr/0010). Дом подключается из
-- Домового чата, Роли выводятся из участия в нём (docs/adr/0006, 0007).

-- Сессии выданы после проверки параметров VK. Личность из VK не переносится
-- в MAX, поэтому все входят заново по initData MAX (как при переходе в 0003).
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- Роли по ADR 0007: Администратор Дома, Жилец, УК. Староста становится
-- Администратором Дома, Ответственный — УК, Консьержа как Роли больше нет.
-- Квартира теперь необязательна: Роль даёт участие в Домовом чате, а
-- Приглашение лишь привязывает Жильца к Квартире.
DO $$
DECLARE check_constraint record;
BEGIN
  FOR check_constraint IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'memberships'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE memberships DROP CONSTRAINT %I', check_constraint.conname);
  END LOOP;
END $$;

UPDATE memberships SET role = CASE role
  WHEN 'headman' THEN 'admin'
  WHEN 'responsible' THEN 'management-company'
  WHEN 'concierge' THEN 'resident'
  ELSE role
END;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin', 'resident', 'management-company'));

-- Два Домовых чата с одним адресом — два разных Дома (ADR 0006).
ALTER TABLE houses DROP CONSTRAINT IF EXISTS houses_address_locality_key;

-- Точка Дома из DaData: Местам рядом не нужен геокодер 2ГИС.
ALTER TABLE houses
  ADD COLUMN lat double precision,
  ADD COLUMN lon double precision,
  ADD CONSTRAINT houses_point_check CHECK (
    (lat IS NULL AND lon IS NULL)
    OR (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180)
  );

-- Домовой чат MAX, из которого создан Дом. chat_id — граница данных Дома.
CREATE TABLE house_chats (
  chat_id bigint PRIMARY KEY CHECK (chat_id <> 0),
  house_id uuid NOT NULL UNIQUE REFERENCES houses(id) ON DELETE CASCADE,
  -- Кто добавил бота: он Администратор Дома, даже если не админ чата.
  created_by_max_user_id bigint CHECK (created_by_max_user_id > 0),
  -- Аккаунт УК, назначенный командой /set_uk.
  management_company_max_user_id bigint CHECK (management_company_max_user_id > 0),
  management_company_username text,
  -- Бот лишился прав администратора или удалён: Доступа к Дому нет.
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Чат, куда добавили бота, но Дом ещё не создан. Создателя запоминаем сразу,
-- ещё до прав администратора; address_required_at — бот уже администратор,
-- а Адрес Дома по названию чата не определился, его выбирает человек.
CREATE TABLE house_chat_onboardings (
  chat_id bigint PRIMARY KEY CHECK (chat_id <> 0),
  chat_title text CHECK (length(chat_title) BETWEEN 1 AND 500),
  created_by_max_user_id bigint CHECK (created_by_max_user_id > 0),
  address_required_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (address_required_at IS NULL OR chat_title IS NOT NULL)
);

-- Уведомление о новом Опросе теперь одно сообщение бота в Домовой чат.
CREATE TABLE house_chat_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (poll_id)
);
CREATE INDEX house_chat_outbox_due ON house_chat_outbox (next_attempt_at) WHERE status = 'pending';
