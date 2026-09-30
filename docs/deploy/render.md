# Демо-развёртывание на Render

`render.yaml` поднимает один бесплатный Node.js web service и бесплатную
PostgreSQL в регионе Frankfurt. Web service отдаёт Mini App и `/api/*`; база
содержит реестр Домовых чатов. Worker бесплатного плана засыпает при простое,
поэтому первый запрос может отвечать с задержкой. Бесплатная база Render
удаляется через 30 дней. Эта конфигурация предназначена для демо, потеря данных
при окончании срока базы принята.

## Первое развёртывание

1. Отправьте ветку `feature/max-house-auth` в GitHub и подключите репозиторий
   `XANXED/MaxTown` к Render.
2. В Render создайте Blueprint из `render.yaml` именно из ветки
   `feature/max-house-auth`. Подтвердите создание web service и базы.
3. Для `maxtown-demo` задайте `BOT_TOKEN`, `MAX_WEBHOOK_SECRET`,
   `MAX_RU_CA_CERT_PEM` и `DADATA_API_KEY` в Environment. Значения не добавлять
   в GitHub или `.env.example`.
   - `MAX_RU_CA_CERT_PEM` — PEM-сертификат Минцифры, полученный из официального
     источника MAX для разработчиков. На старте он записывается во временный
     файл, и Node получает путь через `NODE_EXTRA_CA_CERTS`.
   - `MAX_WEBHOOK_SECRET` — случайная строка длиной 5–256 символов; это то же
     значение передаётся MAX при регистрации webhook.
   - `DADATA_API_KEY` нужен для подсказок адреса Дома.
4. Дождитесь зелёной проверки GitHub Actions `install, typecheck, tests, build`
   и успешного deploy в Render. Render health check использует `/api/health`.
5. В Render Shell или по публичному URL проверьте `GET /api/health` и наличие
   Mini App на `/`.
6. Новая PostgreSQL начинается пустой: записи из Cloudflare KV автоматически
   не переносятся. До переключения webhook подключите тестовый Дом заново:
   выполните `/connect` в его групповом чате, подтвердите Адрес Дома и повторно
   назначьте аккаунт УК, если он был указан. Проверьте вход администратором и
   Жильцом. Не отключайте прежний Worker до этой проверки.
7. После проверки зарегистрируйте webhook MAX по URL
   `https://<имя-сервиса>.onrender.com/api/max/webhook`, задав тот же
   `MAX_WEBHOOK_SECRET`. Вызовите `POST /api/max/register` с заголовком
   `x-max-bot-api-secret: <MAX_WEBHOOK_SECRET>`, чтобы бот установил подписку.

Секреты MAX выдаются в кабинете платформы. API-вызовы отправляются только на
`https://platform-api2.max.ru`; старый домен не используется как TLS fallback.
Node запускается после настройки официального сертификата и добавляет его к
системному хранилищу доверенных CA.

## Последующие релизы

Workflow `.github/workflows/ci.yml` выполняет `npm ci`, typecheck, тесты и сборку
Mini App для каждого push в `feature/max-house-auth`. Render настроен на
`checksPass`: новый deploy запускается после успешных status checks. Перед
первым релизом убедитесь, что GitHub Actions check обязателен для ветки в
настройках репозитория.

Бесплатный план — демо-среда, а не надёжная эксплуатация: он не обеспечивает
постоянную доступность или сохранность данных. Для долгой эксплуатации смените
планы web service и базы на платные до истечения 30 дней базы.
