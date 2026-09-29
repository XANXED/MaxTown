# MaxTown

Мини-апп MAX и бот-помощник жильцов многоквартирного дома.
Хакатон «умный город / умный дом». Жилец видит состояние дома, обращается в
управляющую компанию (УК) через заявки и находит нужные контакты и места
рядом — без звонков и личных походов.

Что именно входит в продукт, ещё решается: термины фиксируются в
`CONTEXT.md`, решения — в `docs/adr/`. Прочитай их перед работой, если они
уже есть. Исследования — в `docs/research/`; официальные источники, с которых
начинать поиск (законы, ГИС ЖКХ, ФИАС, платформа MAX), — в
[docs/research/sources.md](docs/research/sources.md).

## Структура

```
apps/
  miniapp/    мини-апп MAX для жильцов: React + Vite + VKUI, мост MAX (window.WebApp)
  admin/      панель Модератора: React + Vite
  api/        бэкенд: Fastify + Postgres (Node исполняет TypeScript напрямую, без сборки)
  edge/       Cloudflare Worker: запасной публичный адрес, прокси /api/* в api
packages/
  shared/     типы и контракты, общие для фронтендов и бэкенда
design/       токены оформления и материалы для Stitch
docs/         agents/ — настройка скиллов, adr/ — архитектурные решения,
              research/ — исследования и источники
```

Webhook бота MAX, Домовые чаты, DaData и объявления в чаты размещены в
`apps/api/`; отдельный бот-процесс не запускается (docs/adr/0010). Продакшн —
maxtown.ru на сервере Timeweb: `compose.yml` + `compose.prod.yml` с Caddy,
выкладка `./deploy/deploy.sh` (docs/adr/0011, docs/deployment.md).

## Команды

Node ≥ 24, пакетный менеджер — npm (workspaces). pnpm на Node 26 не запускается.

```bash
npm install
npm run dev:miniapp    # http://localhost:5173
npm run dev:admin      # http://localhost:5174
npm run dev:api        # GET /health на API_PORT (по умолчанию 3000)
npm run typecheck      # tsc по всем пакетам
npm test               # vitest по всему репозиторию
```

Переменные окружения — в `.env` в корне (образец `.env.example`).

## Правила

- **Перед любым CSS или разметкой прочитай [design/AGENTS.md](design/AGENTS.md).**
  Там правило «никаких литералов», геометрия мини-аппа и список запретов.
  Токены подключаются через алиас Vite: `import '@design/tokens.css'`.
- В `apps/miniapp` интерфейс строится на VKUI, платформа — мост MAX
  (`window.WebApp`); platform calls держать в адаптерах. Свои стили — только на `var(--…)`.
- Подпись `initData` MAX проверяется только в `apps/api` по официальной
  документации MAX (токеном бота). Данные из клиентского моста
  (`initDataUnsafe`) не являются доказательством личности; API использует
  проверенный `initData`, а Роль выводит из Домового чата через MAX API.
- Типы, которые нужны и фронтенду, и бэкенду, живут в `packages/shared`.
- TypeScript строгий; в коде для Node — только стираемый синтаксис
  (без `enum`, `namespace`, параметров-свойств), относительные импорты с `.ts`.
- Секреты — только в `.env`, в git не попадают. Webhook MAX и outbox
  работают внутри единственного API web-процесса; отдельный bot worker не
  запускать. `apps/edge` — только прокси, логики в нём нет.
- Весь текст интерфейса — на русском.

## Agent skills

Скиллы Мэтта Покока (mattpocock/skills) лежат в `.agents/skills/`, для
Claude Code — симлинки в `.claude/skills/`. Обновление: `npx skills update`.
Основной поток: `/grill-with-docs` → `/to-spec` → `/to-tickets` →
`/implement`. Не знаешь, какой скилл нужен, — `/ask-matt`.

### Taste skill (дизайн интерфейса)

Скиллы Leonxlnx/taste-skill (https://github.com/Leonxlnx/taste-skill) лежат
там же, в `.agents/skills/` с симлинками в `.claude/skills/`, и записаны в
`skills-lock.json`. Они про вкус и качество вёрстки: как уйти от шаблонного
«ИИ-интерфейса».

- `/design-taste-frontend` — основной: читает задачу, выбирает направление,
  проверяет результат перед сдачей. `-v1` — старая версия, не нужна.
- `/redesign-existing-projects` — аудит и доводка уже свёрстанного экрана.
- `/minimalist-ui` — плоский сдержанный стиль без градиентов и тяжёлых теней.
- `/imagegen-frontend-mobile` — концепты мобильных экранов картинками, без кода.
- `/stitch-design-taste` — генерирует DESIGN.md для Stitch.
- `/image-to-code`, `/imagegen-frontend-web` — под Codex и лендинги, здесь
  почти не нужны. `/full-output-enforcement` — не про дизайн: запрещает
  обрезать код заглушками.

**Приоритет: [design/AGENTS.md](design/AGENTS.md) выше Taste skill.** Мини-апп
должен ощущаться нативным для MAX (MAX сделан VK, поэтому интерфейс — на VKUI).
Учитывай системную тему и safe-area через VKUI и CSS `env()`; собственные
стили подчиняются токенам и ограничениям `design/AGENTS.md`.
`design/stitch/DESIGN.md` — исторический макет, не перезаписывается без
отдельной просьбы.

### Issue tracker

Задачи и спеки — в GitHub Issues репозитория XANXED/MaxTown, через `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` и `docs/adr/` в корне. See `docs/agents/domain.md`.

### Project knowledge MCP

Перед ответом о терминах и архитектурных решениях используй ресурсы
`maxtown://context/glossary`, `maxtown://project/rules`,
`maxtown://decisions`, а для поиска и проверки формулировок — инструменты
`search_project_knowledge` и `check_domain_language`. MCP read-only и ограничен
документацией. Если сервер недоступен или не подключён, прочитай исходные
файлы напрямую; они остаются источниками истины. Подробнее —
[`docs/agents/project-mcp.md`](docs/agents/project-mcp.md).
