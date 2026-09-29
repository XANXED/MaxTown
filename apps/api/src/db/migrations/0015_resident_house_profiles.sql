-- Первый вход Жильца в Дом: Квартира, согласие на показ подтверждённого
-- телефона и номера соседних Квартир. Эти сведения относятся к членству в
-- конкретном Доме, а не ко всему аккаунту MAX.

ALTER TABLE memberships
  ADD COLUMN phone_visible_to_neighbors boolean NOT NULL DEFAULT false,
  ADD COLUMN neighbor_apartment_left text,
  ADD COLUMN neighbor_apartment_right text,
  ADD COLUMN neighbor_apartment_below text,
  ADD COLUMN neighbor_apartment_above text,
  ADD COLUMN profile_completed_at timestamptz,
  ADD CONSTRAINT memberships_neighbor_left_format CHECK (
    neighbor_apartment_left IS NULL OR neighbor_apartment_left ~ '^[1-9][0-9]{0,3}[А-Яа-яA-Za-z]?$'
  ),
  ADD CONSTRAINT memberships_neighbor_right_format CHECK (
    neighbor_apartment_right IS NULL OR neighbor_apartment_right ~ '^[1-9][0-9]{0,3}[А-Яа-яA-Za-z]?$'
  ),
  ADD CONSTRAINT memberships_neighbor_below_format CHECK (
    neighbor_apartment_below IS NULL OR neighbor_apartment_below ~ '^[1-9][0-9]{0,3}[А-Яа-яA-Za-z]?$'
  ),
  ADD CONSTRAINT memberships_neighbor_above_format CHECK (
    neighbor_apartment_above IS NULL OR neighbor_apartment_above ~ '^[1-9][0-9]{0,3}[А-Яа-яA-Za-z]?$'
  );
