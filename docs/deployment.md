# Развёртывание MaxTown на Render Free

В проекте один Docker Web Service: он обслуживает VK Mini App, панель Модератора, Fastify API, VK Callback API и фоновую отправку уведомлений во время работы процесса. Единственная отдельная служба — закрытая от публичного интернета база Render PostgreSQL. Render Blueprint находится в [`render.yaml`](../render.yaml); автодеплой срабатывает только после успешных GitHub checks (`checksPass`).

## Что нужно подготовить

- GitHub-репозиторий MaxTown и доступ владельца к Render.
- Созданные в VK Mini Apps приложение и сообщество с включённым Callback API и разрешёнными сообщениями сообщества.
- Длинный пароль Модератора. В Render передаётся только bcrypt-хеш.

До появления доступа к аккаунту VK владельца и Render можно проверять код локально и в CI. Без этих доступов нельзя подтвердить реальный запуск VK, Callback API или публичный Render URL.

## Настройка Render

1. Опубликуйте релизную ветку в GitHub и дождитесь успешных обязательных checks на `main`.
2. В Render Dashboard выберите **New → Blueprint**, подключите GitHub-репозиторий и примените `render.yaml`.
3. Заполните предложенные Blueprint переменные `sync: false`: `VK_APP_ID`, `VK_APP_SECRET`, `VK_GROUP_ID`, `VK_GROUP_TOKEN`, `VK_CALLBACK_SECRET`, `VK_CALLBACK_CONFIRMATION_CODE`, `MODERATOR_PASSWORD_HASH` и `POLL_VOTER_NULLIFIER_SECRET`. Секрет опросов должен содержать не менее 32 случайных байтов; храните его постоянно, ротация позволит жильцам голосовать повторно.
4. Установите адрес Mini App в настройках VK на `https://<имя-сервиса>.onrender.com/`. В настройках Callback API задайте этот же домен и путь `/api/vk/callback`, версию API из `VK_API_VERSION`, секрет и код подтверждения из переменных Render. Включите события `message_allow` и `message_deny`.
5. Дождитесь статуса **Live** и проверьте `https://<имя-сервиса>.onrender.com/api/ready` — ожидается HTTP 200.
6. Откройте Mini App из сообщества VK, проверьте вход и вручную протестируйте уведомление на разрешившем отправку тестовом аккаунте.

### Создание bcrypt-хеша

На машине с Docker запустите Caddy. Утилита запросит пароль интерактивно; не вставляйте пароль в командную строку и не сохраняйте хеш в репозитории:

```sh
docker run --rm -it caddy:2-alpine caddy hash-password
```

Скопируйте bcrypt-хеш в `MODERATOR_PASSWORD_HASH`. API проверяет Basic Auth и наличие включённой записи Модератора в базе. Пять неверных паролей с одного IP приводят к HTTP 429 на 15 минут; счётчик хранится в памяти процесса и сбрасывается при перезапуске или пробуждении Free-сервиса.

## Локальный Compose

Скопируйте `.env.example` в `.env`, задайте значения VK, создайте bcrypt-хеш Модератора, замените пример пароля PostgreSQL и согласуйте `COMPOSE_DATABASE_URL` с `POSTGRES_DB`, `POSTGRES_USER` и `POSTGRES_PASSWORD`. Для хоста `DATABASE_URL` остаётся локальным (`localhost`), а API-контейнер использует `COMPOSE_DATABASE_URL` с host `postgres`. Контейнер базы не публикует порт наружу; API и база находятся во внутренней сети Compose.

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
