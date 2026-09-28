# Временный fallback для вызовов MAX API из Cloudflare Worker

Статус: принято временно для хакатона, 27 сентября 2026 года.

## Контекст

MAX требует обращаться к `platform-api2.max.ru` и доверять корневому
сертификату Минцифры. Бесплатный Cloudflare Worker не доверяет этой цепочке и
возвращает `HTTP 526` на исходящий `fetch`. Custom Origin Trust Store требует
Advanced Certificate Manager, а TCP/TLS-соединения Worker блокируются для
обычного HTTPS-сервиса на порту 443.

Источники:

- <https://dev.max.ru/docs-api>
- <https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-526/>
- <https://developers.cloudflare.com/ssl/origin-configuration/custom-origin-trust-store/>

## Решение

Worker всегда сначала вызывает официальный `platform-api2.max.ru`. Только при
ответе `526` он повторяет тот же HTTPS-запрос через
`platform-api.max.ru`. На дату решения старый домен возвращает тот же MAX API и
использует цепочку, которую Cloudflare проверяет обычным способом. Токен
передаётся только этим двум фиксированным доменам.

Webhook, статика, авторизация и реестр Домовых чатов остаются на Cloudflare;
реестр хранится в Workers KV.

## Последствия

- Проект работает на бесплатном Cloudflare без отдельного прокси.
- Старый домен MAX официально больше не является основным и может перестать
  отвечать. Это допустимый временный риск для хакатона, но не для production.
- Перед production нужно перенести вызовы MAX API в среду, где можно добавить
  Russian Trusted Root CA, либо включить платный Custom Origin Trust Store и
  удалить fallback.
