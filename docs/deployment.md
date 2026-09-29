# Развёртывание MaxTown

Основной продакшн — облачный сервер Timeweb Cloud с доменом **maxtown.ru**
(docs/adr/0011). На сервере docker compose поднимает три контейнера:

- `web` — один образ: Fastify API, мини-апп MAX, панель Модератора, webhook
  бота MAX и фоновые объявления в Домовые чаты. Миграции базы — при старте.
- `postgres` — база во внутренней сети compose, наружу не открыта.
- `caddy` — HTTPS для maxtown.ru (сертификат Let's Encrypt получает сам) и
  прокси в `web`.

Запасные варианты — Render и Cloudflare Worker — описаны в конце.

## Что нужно подготовить

- Бот MAX на платформе для партнёров (https://business.max.ru) с мини-приложением и его токен.
- Серверный ключ DaData (подсказки адресов) — без него Дом не создаётся из Домового чата.
- Ключ 2ГИС для Ближайших мест и карты (необязательно).
- Длинный пароль Модератора. На сервер попадает только bcrypt-хеш.

## Timeweb Cloud: первый запуск

Текущий production-сервер: `root@200.165.226.232`, код — `/opt/maxtown`.

1. **Сервер.** Нужна Ubuntu и минимум 2 ГБ памяти: образ собирает фронтенды
   на сервере. Однократная установка Docker и необходимых утилит выполняется
   из локального клона:

   ```sh
   ./deploy/publish-timeweb.sh --setup
   ```

   Скрипт передаёт только код, не копирует локальный `.env` и не требует
   GitHub-токена на production-сервере.
2. **Доступ.** В файрволе Timeweb откройте входящие 22, 80 и 443 (TCP) и 443 (UDP).
3. **DNS.** В записях домена maxtown.ru: `A @ → 200.165.226.232` и
   `A www → 200.165.226.232`. Удалите конфликтующие A-записи старого хостинга.
   Сертификат Caddy выпустит только после того, как записи разойдутся
   (`getent ahostsv4 maxtown.ru` на сервере показывает `200.165.226.232`).
4. **Ключи и настройки.** Подключитесь к серверу и запустите мастер:

   ```sh
   ssh root@200.165.226.232
   cd /opt/maxtown
   ./deploy/prepare-env.sh
   ```

   Нужно вставить токен MAX, серверный ключ DaData, опциональный ключ 2ГИС,
   имя бота и придумать пароль Модератора. Пароль PostgreSQL, webhook-secret,
   внутренний секрет и секрет Опросов мастер сгенерирует сам. Готовый `.env`
   имеет права `600` и никогда не синхронизируется с локальной машиной.
5. **Запуск:**

   ```sh
   ./deploy/deploy.sh --no-pull
   ```

   Скрипт проверит настройки, соберёт образ, поднимет контейнеры, дождётся
   публичного HTTPS и сам зарегистрирует (или обновит) production webhook в
   MAX. Ошибка токена MAX останавливает проверку с понятным сообщением.
6. **Бот MAX.** В настройках бота укажите корневой адрес мини-приложения
   `https://maxtown.ru/` без `#/welcome` и launch-параметров.
7. **2ГИС.** В кабинете 2ГИС ограничьте ключ доменом maxtown.ru: он встроен в
   код страницы. С российского IP Timeweb Ближайшие места работают (docs/adr/0008).
8. **Проверка в MAX.** Добавьте бота в тестовый групповой чат и выдайте ему
   права администратора. Бот подключит Дом или попросит выбрать адрес. Затем
   откройте мини-приложение кнопкой из чата.

Панель Модератора — `https://maxtown.ru/admin/`.

## Выкладка новой версии

Из локального чистого checkout одной командой:

```sh
./deploy/publish-timeweb.sh --deploy
```

Синхронизация не затрагивает серверные `.env`, `backups/` и данные Docker.
Перед пересборкой deploy сохраняет базу в
`backups/maxtown-<время>.sql.gz`: миграции идут при старте нового API. Если
бэкап не удался, выкладка останавливается, и миграции не запускаются. Старые
бэкапы удаляйте сами.

Полная проверка (мини-апп, API, отказ на поддельном `initData` MAX, вход
Модератора) запускается, если задать учётные данные в окружении, а не
аргументами:

```sh
read -rs MODERATOR_SMOKE_PASSWORD && export MODERATOR_SMOKE_PASSWORD MODERATOR_SMOKE_USER=moderator
./deploy/deploy.sh
```

Логи: `docker compose -p maxtown -f compose.yml -f compose.prod.yml logs -f web caddy`.

## Бэкапы и восстановление

Бэкап вручную:

```sh
docker compose -p maxtown -f compose.yml -f compose.prod.yml exec -T postgres \
  sh -ec 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backups/manual.sql.gz
```

Восстановление в пустую базу, например на новом сервере до первого запуска `web`:

```sh
docker compose -p maxtown -f compose.yml -f compose.prod.yml up -d postgres
gunzip -c backups/<файл>.sql.gz | docker compose -p maxtown -f compose.yml -f compose.prod.yml \
  exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
./deploy/deploy.sh --no-pull
```

Бэкапы лежат на том же сервере. Для защиты от потери сервера копируйте их
наружу, например в S3-хранилище Timeweb.

## Как это устроено

- Caddy получает запросы на 80 и 443. HTTP он переводит на HTTPS, `www.maxtown.ru`
  — на `maxtown.ru`, остальное передаёт в `web:3000`. Порт API наружу не
  открыт: в `compose.yml` он привязан к `127.0.0.1`.
- API видит настоящий адрес человека из `X-Forwarded-For`. Этому заголовку он
  доверяет только от адресов частной сети Docker (`TRUST_PROXY=uniquelocal`).
  Без этого лимит неверных паролей Модератора (5 попыток за 15 минут)
  закрывал бы вход всем сразу.
- `MAXTOWN_PUBLIC_URL=https://maxtown.ru`: на этот адрес `/api/max/register`
  подписывает webhook бота.
- MAX API вызывается только через актуальный `platform-api2.max.ru`. Russian
  Trusted Root CA Минцифры закреплён в образе и подключён через
  `NODE_EXTRA_CA_CERTS`; токен не отправляется на устаревший домен.
- Новый Опрос: уведомление в ленте мини-аппа и одно сообщение бота в Домовой
  чат с кнопкой «Проголосовать». Личных рассылок нет.

## Локальный Compose

Скопируйте `.env.example` в `.env` и заполните:
- значения бота MAX и ключ DaData;
- bcrypt-хеш Модератора;
- пароль PostgreSQL вместо примера. `COMPOSE_DATABASE_URL` согласуйте с `POSTGRES_DB`, `POSTGRES_USER` и `POSTGRES_PASSWORD`.

С хоста API ходит в базу по `DATABASE_URL` (`localhost`), а API-контейнер — по `COMPOSE_DATABASE_URL` с host `postgres`.

```sh
docker compose config
docker compose up --build
```

Для полного чистого smoke-прогона используйте `./deploy/compose-smoke.sh`.
Скрипт создаёт отдельный Compose-проект и удаляет его после проверки.
Контракты деплоя проверяет `npm test -- deploy`, модель Timeweb в CI проверяет
`docker compose -f compose.yml -f compose.prod.yml config`.

## Запасной вариант: Render и Cloudflare Worker

Прежний путь сохранён в репозитории:
- API и база — на Render по [`render.yaml`](../render.yaml);
- публичный адрес — Cloudflare Worker `apps/edge`, он проксирует `/api/*` в Render.

У этого пути два ограничения:
- Render во Франкфурте: с иностранного IP 2ГИС не отвечает, поэтому Ближайшие места не работают;
- Render Free засыпает после 15 минут простоя, а бесплатная база удаляется через 30 + 14 дней.

1. В Render Dashboard: **New → Blueprint**, репозиторий, `render.yaml`.
   Заполните переменные `sync: false`:
   - `BOT_TOKEN`;
   - `MAX_WEBHOOK_SECRET`;
   - `MAXTOWN_INTERNAL_SECRET`;
   - `DADATA_API_KEY`;
   - `MODERATOR_PASSWORD_HASH`;
   - `POLL_VOTER_NULLIFIER_SECRET`.
2. Дождитесь **Live** и проверьте `https://<имя-сервиса>.onrender.com/api/ready`.
3. В Cloudflare задайте Worker'у `API_ORIGIN=https://<имя-сервиса>.onrender.com`
   и опубликуйте его: `npm run deploy:cloudflare`. Адрес мини-приложения в
   настройках бота MAX — адрес Worker'а.
4. Подпишите webhook: тот же `curl … /api/max/register`, но на адрес Worker'а.

Подробности: [ограничения Free](https://render.com/docs/free),
[автодеплой после CI checks](https://render.com/docs/deploys),
[схема Blueprint](https://render.com/docs/blueprint-spec).
