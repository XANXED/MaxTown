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
