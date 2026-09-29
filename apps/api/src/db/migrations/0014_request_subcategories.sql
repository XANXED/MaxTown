-- Подкатегория Заявки: что именно сломалось (docs/adr/0012). Список живёт в
-- packages/shared/src/requests.ts и проверяется кодом, поэтому здесь — только
-- формат id. NULL — Категория «Другое» или Заявка, поданная до подкатегорий.
ALTER TABLE requests
  ADD COLUMN subcategory text CHECK (subcategory IS NULL OR subcategory ~ '^[a-z0-9-]{1,40}$');
