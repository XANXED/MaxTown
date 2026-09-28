# MaxTown

VK-бот и мини-апп — помощник жильцов многоквартирного дома:
состояние дома, заявки в управляющую компанию, полезные контакты и адреса.
Проект хакатона «умный город / умный дом».

## Запуск

Нужен Node 24 или новее.

```bash
npm install
cp .env.example .env     # заполните параметры VK и базы
cp .env.example .env     # впишите BOT_TOKEN и DADATA_API_KEY, если нужен бот

npm run dev:miniapp      # мини-апп жильцов, http://localhost:5173
npm run dev:admin        # панель Модератора, http://localhost:5174
npm run dev:api          # API, http://localhost:3000/health
npm run dev:bot          # Worker (бот и API), http://localhost:8787
```

Проверки: `npm run typecheck`, `npm test` и `npm run smoke:mcp`.

### Локальный запуск без VK

Одной командой, после того как Postgres установлен (см. ниже):

```bash
npm run local            # создаст .env, если его нет, проверит Postgres,
                         # запустит API, мини-апп и панель, напечатает ссылки входа
npm run local -- --users 5   # ссылок входа — на пять Жильцов
```

Если порты заняты: `MINIAPP_PORT=5183 ADMIN_PORT=5184 API_PORT=3100 npm run local`.
Модератор в созданном `.env` — `moderator` / `moderator`.

Вручную то же самое:

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

Для подключения Дома запустите `dev:miniapp` вместе с `dev:bot`:
Vite направляет `/api` в тот же Worker, который работает на Cloudflare.
`dev:api` — отдельный ранний сервер, в нём нет сценария выбора адреса.
Локальный KV изолирован от опубликованного; данные запуска MAX проверяются
на сервере и в локальном режиме.

Браузерный регрессионный тест: `npx playwright install chromium --only-shell`,
затем `npm run test:e2e`. Он использует production-сборку интерфейса, настоящий
обработчик Worker и тестовые MAX/DaData/KV: проверяет зависание запроса,
выбор адреса, создание Дома, отображение адреса и повторную загрузку.

## Публичная версия

Мини-приложение, API авторизации и webhook бота работают в одном Cloudflare
Worker: <https://maxtown.maxtown-bot.workers.dev>.

```bash
npm run build:cloudflare   # локальная проверка сборки Worker
npm run deploy:cloudflare  # сборка мини-аппы и публикация Worker
```

Домовые чаты Worker хранит в Cloudflare KV. После добавления бота в групповой
чат нужно выдать ему права администратора. Бот попробует определить точный
адрес по названию чата. При одном совпадении Дом создастся автоматически, при
неоднозначном названии администратор получит кнопку «Указать адрес».

Локально серверный ключ DaData задаётся в корневом `.env`:

```dotenv
DADATA_API_KEY=ваш_ключ
```

Для публичного Worker ключ загружается как секрет и не хранится в репозитории:

```bash
npx wrangler secret put DADATA_API_KEY --config apps/bot/wrangler.jsonc
```

Если бот получил права до настройки webhook, снимите и снова выдайте их один
раз, чтобы MAX прислал новое событие. Если MAX не прислал событие смены прав,
отправьте в Домовом чате команду `/connect`: бот повторно проверит админку и
запустит определение адреса.

### Роли в Доме

- Человек, впервые добавивший бота, и текущие администраторы Домового чата —
  **Администраторы Дома**.
- Остальные участники чата — **Жильцы**.
- Администратор назначает один аккаунт **УК** командой `/set_uk @username`.
  Аккаунт УК должен состоять в этом же чате. Если он также администратор чата,
  у него одновременно будут роли УК и Администратора Дома.

Роли вычисляются заново по актуальному составу и правам участников при входе в
мини-приложение. Назначение УК хранится отдельно для каждого Дома.

## Где что лежит

- `apps/` — приложения: `miniapp`, `admin`, `api` (в API размещены Callback API и отправка VK-уведомлений).
- `packages/shared/` — общие типы.
- `design/` — токены оформления и материалы для Stitch.
- `docs/` — архитектурные решения, исследования и настройка агентов.
  Официальные источники по теме — в [docs/research/sources.md](docs/research/sources.md).

Как работать с ИИ-агентами в этом репозитории — в [AGENTS.md](AGENTS.md).
