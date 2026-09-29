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

1. **Сервер.** В панели Timeweb Cloud создайте облачный сервер на Ubuntu 24.04
   (или готовый образ с Docker). Нужно от 2 ГБ памяти: образ собирает
   фронтенды на сервере, на 1 ГБ сборка падает — тогда добавьте swap.
2. **Доступ.** В файрволе Timeweb откройте входящие 22, 80 и 443 (TCP) и 443 (UDP).
3. **DNS.** В записях домена maxtown.ru: `A @ → IP сервера` и `A www → IP сервера`.
   Сертификат Caddy выпустит только после того, как записи разойдутся
   (`dig +short maxtown.ru` на своём компьютере показывает IP сервера).
4. **Docker.** Если в образе его нет: `curl -fsSL https://get.docker.com | sh`.
   Проверка: `docker compose version`. Если Docker Hub с сервера недоступен,
   подключите зеркало реестра — у Timeweb Cloud есть своё (см. их документацию).
5. **Код и настройки:**

   ```sh
   git clone https://github.com/XANXED/MaxTown.git /opt/maxtown
   cd /opt/maxtown
   git switch <ветка продакшна>
   cp .env.production.example .env
   nano .env        # заполнить; пояснения к каждому значению — в файле
   ```

   Хеш пароля Модератора: `npm run moderator:hash -- <пароль>` на своей машине
   или `docker run --rm -it caddy:2-alpine caddy hash-password` на сервере.
   В `.env` значение хеша — в одинарных кавычках: в нём есть `$`.
6. **Запуск:** `./deploy/deploy.sh`. Скрипт проверит `.env`, соберёт образ,
   поднимет контейнеры и дождётся `https://maxtown.ru/api/ready`.
7. **Бот MAX.** В настройках бота укажите адрес мини-приложения
   `https://maxtown.ru/` и один раз подпишите бота на события:

   ```sh
   curl -X POST -H "x-maxtown-internal-secret: <MAXTOWN_INTERNAL_SECRET из .env>" \
     https://maxtown.ru/api/max/register
   ```

8. **2ГИС.** В кабинете 2ГИС ограничьте ключ доменом maxtown.ru: он встроен в
   код страницы. С российского IP Timeweb Ближайшие места работают (docs/adr/0008).
9. **Проверка в MAX.** Добавьте бота в тестовый групповой чат и выдайте ему
   права администратора. Бот подключит Дом или попросит выбрать адрес. Затем
   откройте мини-приложение кнопкой из чата.

Панель Модератора — `https://maxtown.ru/admin/`.

## Выкладка новой версии

На сервере, в `/opt/maxtown`:

```sh
./deploy/deploy.sh             # git pull, бэкап базы, пересборка, проверка
./deploy/deploy.sh --no-pull   # выложить то, что уже лежит в папке
```

Перед пересборкой скрипт сохраняет базу в `backups/maxtown-<время>.sql.gz`:
миграции идут при старте нового API. Если бэкап не удался, выкладка
останавливается, и миграции не запускаются. Старые бэкапы удаляйте сами.

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
- MAX API подписан Russian Trusted Root CA. Node его не знает, поэтому API
  уходит на запасной домен MAX (docs/adr/0004). Если запасной домен перестанет
  отвечать, добавьте корень Минцифры в контейнер через `NODE_EXTRA_CA_CERTS`.
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
