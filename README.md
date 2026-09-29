# MaxTown

Бот и мини-приложение MAX — помощник жильцов многоквартирного дома:
состояние дома, заявки в управляющую компанию, полезные контакты и места рядом,
Опросы соседей и режим ремонта. Проект хакатона «умный город / умный дом».

## Как это устроено

- Дом подключается из **Домового чата MAX**. Бота MaxTown добавляют в групповой
  чат и выдают ему права администратора. Бот ищет точный адрес по названию чата
  через DaData (ГАР). При одном совпадении Дом создаётся сам, иначе
  администратор чата получает кнопку «Указать адрес».
- **Роли** выводятся из чата и пересчитываются при каждом входе:
  - человек, добавивший бота, и администраторы чата — **Администраторы Дома**;
  - остальные участники — **Жильцы**;
  - один аккаунт **УК** назначает Администратор командой `/set_uk @username`.
- Мини-апп входит по подписанному `initData` MAX. Все данные Дома живут в API
  на Postgres: Опросы, режим ремонта, услуги, Контакты, Места рядом,
  интернет-Поставщики.
- **Заявки** ([docs/adr/0012](docs/adr/0012-requests-processed-by-uk-and-admin.md)):
  - Жилец подаёт Заявку с фото, УК или Администратор Дома берёт её в работу,
    назначает Визит и отмечает выполненной, Жилец подтверждает исправление;
  - Заявку об Общем имуществе видит весь Дом: плашка «Состояние дома» на главной
    становится оранжевой, соседи отмечают «У меня тоже»;
  - три Жильца об одной Системе за 2 часа открывают Аварию сами;
  - Выполненная Заявка без ответа закрывается после напоминания.
- Публичный адрес — https://maxtown.ru: сервер Timeweb, Caddy и API. Решения — в
  [docs/adr/0010](docs/adr/0010-max-only-platform-api-on-postgres.md) и
  [0011](docs/adr/0011-production-on-timeweb-vps.md). Cloudflare Worker
  (`apps/edge`) — запасной адрес.

Если бот получил права до настройки webhook, снимите и снова выдайте их или
отправьте в чате `/connect`: бот ещё раз проверит свои права и заново определит адрес.

## Запуск

Нужен Node 24 или новее и PostgreSQL 13+.

```bash
npm install
npm run local            # создаст .env, если его нет, проверит Postgres,
                         # запустит API, мини-апп и панель, напечатает ссылки входа
npm run local -- --users 5   # ссылок входа — на пять Жильцов
```

Если порты заняты: `MINIAPP_PORT=5183 ADMIN_PORT=5184 API_PORT=3100 npm run local`.
Модератор в созданном `.env` — `moderator` / `moderator`.

Проверки: `npm run typecheck`, `npm test` и `npm run smoke:mcp`.

### Вход без клиента MAX

Вне MAX мини-апп берёт `initData` из фрагмента адреса (`#WebAppData=…`), как
настоящий клиент MAX. Ссылку подписывает тем же `BOT_TOKEN`, которым API
проверяет подпись, команда `npm run dev:link`. Если своего токена в `.env` нет,
`npm run local` подпишет локальным токеном: вход работает, а Домовые чаты MAX — нет.

В настройках мини-приложения MAX указывайте корневой URL `https://maxtown.ru`
без `#/welcome` и параметров запуска. MAX сам добавляет `WebAppData` и
`WebAppStartParam`.
Для ранее настроенных ссылок с маршрутом приложение также поддерживает
формат `#/welcome?WebAppStartParam=…#WebAppData=…` и сохраняет параметры при
навигации; данные входа всегда проверяются сервером.

```bash
npm run dev:link          # человек с MAX ID 1
npm run dev:link -- 2     # второй человек — откройте в другой вкладке
```

Панель Модератора — http://localhost:5174/admin/, браузер спросит логин и
пароль из `.env`.

### Вручную

PostgreSQL на Manjaro/Arch, один раз:

```bash
sudo pacman -S postgresql
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -iu postgres psql -c "CREATE USER maxtown WITH PASSWORD 'maxtown';" \
                       -c "CREATE DATABASE maxtown OWNER maxtown;"
```

`.env` (образец — `.env.example`):

```bash
DATABASE_URL=postgres://maxtown:maxtown@localhost:5432/maxtown
BOT_TOKEN=                 # токен бота MAX; для dev:link подойдёт любая строка
DADATA_API_KEY=            # адрес Дома по названию чата
MODERATOR_USERNAME=moderator
# npm run moderator:hash -- <пароль> печатает готовую строку:
MODERATOR_PASSWORD_HASH='$2b$12$…'
POLL_VOTER_NULLIFIER_SECRET=   # openssl rand -hex 32
```

Дальше в трёх терминалах: `npm run dev:api` (миграции применятся сами),
`npm run dev:miniapp` и `npm run dev:admin`. Мини-апп и панель ходят в API через
прокси Vite `/api`.

### Браузерный тест

`npx playwright install chromium --only-shell`, затем:

```bash
TEST_DATABASE_URL='postgres://…?options=-c%20search_path%3Dmaxtown_test' npm run test:e2e
```

Тест берёт production-сборку мини-аппа, настоящий API на Postgres, а MAX и
DaData подменяет. Он проверяет:
- зависший вход;
- выбор адреса и создание Дома;
- главную и повторную загрузку страницы.

## Развёртывание

Продакшн — https://maxtown.ru на облачном сервере Timeweb Cloud
([docs/adr/0011](docs/adr/0011-production-on-timeweb-vps.md)). Там работает
docker compose: API с мини-аппом и панелью, Postgres и Caddy с HTTPS. Пошагово —
в [`docs/deployment.md`](docs/deployment.md). Кратко, на сервере:

```bash
cp .env.production.example .env   # один раз: заполнить
./deploy/deploy.sh                # git pull, бэкап базы, сборка, проверка https://maxtown.ru
```

Подписка бота на события делается один раз после первого запуска:

```bash
curl -X POST -H "x-maxtown-internal-secret: $MAXTOWN_INTERNAL_SECRET" \
  https://maxtown.ru/api/max/register
```

Запасной путь — Render ([`render.yaml`](render.yaml)) и Cloudflare Worker
(`npm run deploy:cloudflare`). Он описан в конце той же инструкции.

Проектный read-only MCP для Codex запускается командой `npm run mcp:project`.
Подключение, ресурсы и инструменты описаны в
[`docs/agents/project-mcp.md`](docs/agents/project-mcp.md).

## Где что лежит

- `apps/`:
  - `miniapp` — мини-апп MAX;
  - `admin` — панель Модератора;
  - `api` — API на Postgres, webhook бота MAX, Домовые чаты;
  - `edge` — Cloudflare Worker, запасной публичный адрес.
- `packages/shared/` — общие типы.
- `design/` — токены оформления и материалы для Stitch.
- `docs/` — архитектурные решения, исследования и настройка агентов.
  Официальные источники по теме — в [docs/research/sources.md](docs/research/sources.md).

Как работать с ИИ-агентами в этом репозитории — в [AGENTS.md](AGENTS.md).
