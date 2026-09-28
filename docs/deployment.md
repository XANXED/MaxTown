# Развёртывание MaxTown на Render Free

В проекте один Docker Web Service: он обслуживает VK Mini App, панель Модератора, Fastify API, VK Callback API и фоновую отправку уведомлений во время работы процесса. Единственная отдельная служба — закрытая от публичного интернета база Render PostgreSQL. Render Blueprint находится в [`render.yaml`](../render.yaml); автодеплой срабатывает только после успешных GitHub checks (`checksPass`).

## Что нужно подготовить

- GitHub-репозиторий MaxTown и доступ владельца к Render.
- Созданные в VK Mini Apps приложение и сообщество с включённым Callback API и разрешёнными сообщениями сообщества.
- `VK_APP_ID`, `VK_APP_SECRET`, `VK_GROUP_ID` и `VK_GROUP_TOKEN` из созданных приложения и сообщества VK.

Render создаёт Web Service и базу по Blueprint. Render автоматически генерирует секрет Callback API, пароль Модератора и ключ анонимизации опросов. Код подтверждения Callback API выдаёт VK только после добавления адреса сервера, поэтому его нужно внести в Render после первого деплоя. Владелец Render всё ещё должен один раз применить Blueprint и передать реальные реквизиты VK: их невозможно создать на стороне Render.

## Настройка Render

1. В Render Dashboard выберите **New → Blueprint**, подключите GitHub-репозиторий `XANXED/MaxTown` и примените `render.yaml` из `main`.
2. Заполните предложенные обязательные реквизиты VK: `VK_APP_ID`, `VK_APP_SECRET`, `VK_GROUP_ID`, `VK_GROUP_TOKEN`. Render сам задаст `VK_CALLBACK_SECRET`, `MODERATOR_PASSWORD` и `POLL_VOTER_NULLIFIER_SECRET`.
3. Дождитесь первого деплоя **Live**. API запускается без кода подтверждения, который ещё не выдан VK. В настройках Callback API сообщества добавьте сервер `https://<имя-сервиса>.onrender.com/api/vk/callback`, вставьте `VK_CALLBACK_SECRET` из Render и сохраните настройки. VK покажет код подтверждения.
4. Добавьте выданный VK код как `VK_CALLBACK_CONFIRMATION_CODE` в **Environment** сервиса Render и дождитесь успешного повторного деплоя. Затем вернитесь в настройки Callback API и нажмите подтверждение сервера. VK отправит confirmation event; API ответит точным выданным кодом. Включите события `message_allow` и `message_deny`, используя версию API из `VK_API_VERSION`.
5. Установите адрес Mini App в настройках VK на `https://<имя-сервиса>.onrender.com/`.
6. Проверьте `https://<имя-сервиса>.onrender.com/api/ready` — ожидается HTTP 200. Откройте Mini App из сообщества VK и вручную проверьте вход и уведомление на тестовом аккаунте, разрешившем сообщения.

### Доступ Модератора

Render случайно создаёт `MODERATOR_PASSWORD`; API хеширует его через bcrypt при запуске. Когда понадобится открыть панель Модератора, скопируйте сгенерированное значение из переменных сервиса Render и используйте имя `moderator`. Не записывайте пароль в репозиторий или логи. Чтобы сменить пароль, обновите `MODERATOR_PASSWORD` в Render Dashboard. Существующие окружения с `MODERATOR_PASSWORD_HASH` продолжат работать.

Для другого окружения, которое использует bcrypt-хеш, создайте его интерактивно через Caddy; пароль не попадёт в аргументы процесса.

```sh
docker run --rm -it caddy:2-alpine caddy hash-password
```

Хеш можно положить в локальный `.env` как `MODERATOR_PASSWORD_HASH`. API проверяет Basic Auth и наличие включённой записи Модератора в базе. Пять неверных паролей с одного IP приводят к HTTP 429 на 15 минут; счётчик хранится в памяти процесса и сбрасывается при перезапуске или пробуждении Free-сервиса.

## Локальный Compose

Скопируйте `.env.example` в `.env`, задайте значения VK, имя Модератора и пароль длиной не менее 32 ASCII-символов (либо bcrypt-хеш), замените пример пароля PostgreSQL и согласуйте `COMPOSE_DATABASE_URL` с `POSTGRES_DB`, `POSTGRES_USER` и `POSTGRES_PASSWORD`. Для хоста `DATABASE_URL` остаётся локальным (`localhost`), а API-контейнер использует `COMPOSE_DATABASE_URL` с host `postgres`. Контейнер базы не публикует порт наружу; API и база находятся во внутренней сети Compose.

```sh
docker compose config
docker compose up --build
```

Для полного чистого smoke-прогона используйте `./deploy/compose-smoke.sh`. Скрипт создаёт отдельный Compose-проект и удаляет его после проверки.

## Проверка после деплоя

```sh
./deploy/smoke.sh https://<имя-сервиса>.onrender.com
```

Smoke проверяет Mini App, Admin, API readiness, отказ на поддельных VK launch-параметрах и Moderator Basic Auth. Чтобы проверить форму Moderator, задайте `MODERATOR_SMOKE_USER` и `MODERATOR_SMOKE_PASSWORD` из менеджера секретов среды запуска; не передавайте пароль аргументом процесса и не записывайте его в историю оболочки или CI-лог.

Контракт Render YAML и CI проверяются командами `npm test -- deploy/render-blueprint.test.ts deploy/deployment.test.ts`. Владелец аккаунта может дополнительно проверить Blueprint через Render CLI после входа и выбора workspace:

```sh
render blueprints validate render.yaml
```

Это обращение к Render API и требует владельческого входа. Доступ к Render API не хранится в GitHub CI.

## Уведомления и ограничения Free

VK direct messages необязательны: основное уведомление о новом Опросе записывается в базу и показывается в ленте Mini App. VK получает отдельное уведомление только после разрешения жильца. Outbox обрабатывается тем же API-процессом, когда Render его будит; на Free нельзя обещать немедленную доставку при спящем сервисе.

Render Free Web Service засыпает после 15 минут без входящих запросов; пробуждение обычно занимает около минуты. Бесплатная PostgreSQL база объёмом 1 ГБ истекает через 30 дней. После истечения даётся 14 дней на повышение тарифа, затем база удаляется. Поэтому Free предназначен для проверки и демонстрации, но не гарантирует долговременное хранение или восстановление пользовательских данных. Перед реальным публичным запуском выберите постоянную базу с резервным копированием. Подробности: [ограничения Free](https://render.com/docs/free), [автодеплой после CI checks](https://render.com/docs/deploys) и [схема Blueprint](https://render.com/docs/blueprint-spec).
