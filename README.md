# MaxTown

VK-бот и мини-апп — помощник жильцов многоквартирного дома:
состояние дома, заявки в управляющую компанию, полезные контакты и адреса.
Проект хакатона «умный город / умный дом».

## Запуск

Нужен Node 24 или новее.

```bash
npm install
cp .env.example .env     # заполните параметры VK и базы

npm run dev:miniapp      # мини-апп жильцов, http://localhost:5173
npm run dev:admin        # панель Модератора, http://localhost:5174
npm run dev:api          # API, http://localhost:3000/health
```

Проверки: `npm run typecheck`, `npm test` и `npm run smoke:mcp`.

### Локальный запуск без VK

Нужен PostgreSQL 13+. На Manjaro/Arch один раз:

```bash
sudo pacman -S postgresql
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -iu postgres psql -c "CREATE USER maxtown WITH PASSWORD 'maxtown';" \
                       -c "CREATE DATABASE maxtown OWNER maxtown;"
```

`.env` для локального запуска (ключи VK настоящие не нужны):

```bash
DATABASE_URL=postgres://maxtown:maxtown@localhost:5432/maxtown
VK_APP_ID=1
VK_APP_SECRET=local-dev-secret
MODERATOR_USERNAME=moderator
# npm run moderator:hash -- <пароль> печатает готовую строку:
MODERATOR_PASSWORD_HASH='$2b$12$…'
POLL_VOTER_NULLIFIER_SECRET=   # openssl rand -hex 32
```

Дальше в трёх терминалах `npm run dev:api` (миграции применятся сами),
`npm run dev:miniapp`, `npm run dev:admin`. Мини-апп и панель ходят в API
через прокси Vite `/api`.

Вне VK мини-апп входит по launch-параметрам из адреса. Их подписывает тем же
`VK_APP_SECRET` команда `npm run dev:link` — она печатает ссылку, API проверяет
подпись как у настоящего VK:

```bash
npm run dev:link          # Жилец vk_user_id=1
npm run dev:link -- 2     # второй человек — откройте в другой вкладке
```

Панель Модератора — http://localhost:5174/admin/, браузер спросит логин и
пароль из `.env`.

## Развёртывание

Для Render Free используйте [`render.yaml`](render.yaml) и инструкцию
[`docs/deployment.md`](docs/deployment.md). GitHub Actions проверяет изменения;
Render деплоит только после успешных checks. Free Web Service засыпает при
простоях, а бесплатная PostgreSQL база ограничена сроком хранения — подробности
и шаги запуска описаны в инструкции.

Проектный read-only MCP для Codex запускается командой `npm run mcp:project`.
Подключение, ресурсы и инструменты описаны в
[`docs/agents/project-mcp.md`](docs/agents/project-mcp.md).

## Где что лежит

- `apps/` — приложения: `miniapp`, `admin`, `api` (в API размещены Callback API и отправка VK-уведомлений).
- `packages/shared/` — общие типы.
- `design/` — токены оформления и материалы для Stitch.
- `docs/` — архитектурные решения, исследования и настройка агентов.
  Официальные источники по теме — в [docs/research/sources.md](docs/research/sources.md).

Как работать с ИИ-агентами в этом репозитории — в [AGENTS.md](AGENTS.md).
