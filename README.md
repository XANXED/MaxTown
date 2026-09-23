# MaxTown

Мини-апп для мессенджера MAX — помощник жильцов многоквартирного дома:
состояние дома, заявки в управляющую компанию, полезные контакты и адреса.
Проект хакатона «умный город / умный дом».

## Запуск

Нужен Node 24 или новее.

```bash
npm install
cp .env.example .env     # впишите BOT_TOKEN, если нужен бот

npm run dev:miniapp      # мини-апп жильцов, http://localhost:5173
npm run dev:admin        # панель УК, http://localhost:5174
npm run dev:api          # API, http://localhost:3000/health
npm run dev:bot          # бот MAX
```

Проверки: `npm run typecheck` и `npm test`.

## Где что лежит

- `apps/` — приложения: `miniapp`, `admin`, `api`, `bot`.
- `packages/shared/` — общие типы.
- `design/` — токены оформления MAX, темы и материалы для Stitch.
- `docs/` — архитектурные решения и настройка агентов.

Как работать с ИИ-агентами в этом репозитории — в [AGENTS.md](AGENTS.md).
