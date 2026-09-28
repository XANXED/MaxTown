# 2ГИС API: карты и поиск мест вокруг дома

Справка для внедрения экрана «Места рядом» в `apps/miniapp`.
Собрано 2026-09-28 по официальной документации 2ГИС. Перед кодом сверяйся
с первоисточниками — параметры и тарифы меняются.

Источники:
- Платформа API: https://docs.2gis.com/api-platform?tab=maps
- MapGL JS, первые шаги: https://docs.2gis.com/ru/mapgl/start/first-steps
- MapGL JS, справочник классов: https://docs.2gis.com/ru/mapgl/reference/class
- Places API, обзор: https://docs.2gis.com/ru/api/search/places/overview
- Places API, `/3.0/items`: https://docs.2gis.com/ru/api/search/places/reference/3.0/items
- Categories API: https://docs.2gis.com/ru/api/search/categories/overview

## Что нам нужно

| Задача | Продукт 2ГИС |
|---|---|
| Показать карту с домом и точками | **MapGL JS API** (WebGL-карта в браузере) |
| Найти аптеки, магазины и т. п. рядом с домом | **Places API** (`catalog.api.2gis.com/3.0/items`) |
| Получить ID рубрик («Аптеки», «Продукты») | **Categories API** (`/2.0/catalog/rubric/*`) |

## Ключ

- Ключ выдаётся в личном кабинете Platform Manager: демо-ключ или подписка.
- Один и тот же ключ может быть подключён к нескольким сервисам (MapGL, Places),
  но каждый сервис нужно включить отдельно.
- Биллинг Places — по успешным (HTTP 200) запросам в месяц; лимиты зависят
  от тарифа, у демо-ключа они ограничены.
- Правило проекта: ключ только в `.env`. Ключ MapGL неизбежно попадает в клиент
  (его ограничивают по домену в кабинете). Запросы к Places проксируются
  через `apps/api`, чтобы не светить второй ключ, — **без кеширования ответов**
  (см. «Лицензия» ниже и ADR-0003).

## Лицензия (https://law.2gis.ru/api-rules, проверено 2026-09-28)

- «Запрещается сохранять, обрабатывать, изменять, распространять или доводить
  до всеобщего сведения полученные с использованием Сервиса данные (включая
  результаты геокодирования), за исключением случаев временного хранения
  (кэширования) результатов геокодирования исключительно для целей
  использования в рамках Сервиса». Результаты Places под исключение не
  подпадают: не кешировать, не складывать в базу, не править поверх.
- Свободно — только некоммерческое использование; коммерческое — по договору
  (content@2gis.ru).
- Каждый показ — с атрибуцией «Работает на API 2ГИС. Лицензионное соглашение»;
  в мобильном приложении допустим логотип 2ГИС.
- Демо-ключ — 30 дней, с ограничением числа запросов
  (https://dev.2gis.ru/en/api).

Предлагаемые переменные: `DGIS_MAP_KEY` (клиент, через `VITE_DGIS_MAP_KEY`),
`DGIS_PLACES_KEY` (только сервер).

## MapGL JS API

### Подключение

npm (для Vite/React):

```ts
import { load } from '@2gis/mapgl';

const mapgl = await load();          // загружает https://mapgl.2gis.com/api/js/v1
const map = new mapgl.Map('container', {
  center: [37.615655, 55.768005],    // [долгота, широта] — именно в таком порядке
  zoom: 16,
  key: import.meta.env.VITE_DGIS_MAP_KEY,
});
```

Либо тегом: `<script src="https://mapgl.2gis.com/api/js/v1"></script>` →
глобальная `mapgl`. Контейнеру нужны явные размеры.

### Map

- `new mapgl.Map(container, { center, zoom, key, ... })`
- `setCenter(center, options?)`, `getCenter()`
- `setZoom(zoom, options?)`, `getZoom()`
- `on(type, listener)`, `off(type, listener)`
- `destroy()` — освобождает ресурсы. **Обязательно вызывать в cleanup `useEffect`.**

### Marker

```ts
const marker = new mapgl.Marker(map, {
  coordinates: [lon, lat],
  icon: '/icons/pharmacy.svg',       // MarkerIconOptions: url, size, anchor
  hoverIcon: '/icons/pharmacy-hover.svg',
  label: { text: 'Аптека' },         // MarkerLabelOptions
});
marker.on('click', () => { /* открыть карточку места */ });
marker.destroy();
```

Методы: `setCoordinates`, `getCoordinates`, `setIcon`, `setLabel`,
`setRotation`, `on` / `off` / `once`, `destroy`.

Для большого числа точек есть отдельный пакет кластеризации
`@2gis/mapgl-clusterer` (проверить API перед использованием).

### React-шаблон

```tsx
useEffect(() => {
  let map: mapgl.Map | undefined;
  let cancelled = false;
  load().then((mapgl) => {
    if (cancelled) return;
    map = new mapgl.Map(containerRef.current!, { center, zoom: 16, key });
  });
  return () => { cancelled = true; map?.destroy(); };
}, []);
```

Держать загрузку MapGL в адаптере (как VK Bridge), экран получает готовые данные.

## Places API — поиск мест рядом

`GET https://catalog.api.2gis.com/3.0/items`

### Основные параметры

| Параметр | Смысл |
|---|---|
| `key` | ключ, обязателен |
| `q` | текстовый запрос, 1–500 символов (`аптека`) |
| `rubric_id` | ID рубрик через запятую (требует `region_id` или гео-ограничения) |
| `point` | `lon,lat` — центр поиска |
| `radius` | метры, 0–50 000; с `point` по умолчанию 250 |
| `location` | `lon,lat` пользователя — для расчёта расстояния / сортировки |
| `sort` | `relevance` (по умолч.), `distance`, `rating`, `name`, … |
| `type` | `branch` (организации), `building`, `parking`, `station`, `attraction`, … |
| `fields` | доп. поля ответа, через запятую |
| `page`, `page_size` | страница с 1; размер 1–50, по умолчанию 20. **Демо-ключ: не больше 10** (проверено 2026-09-28) |
| `work_time` | `now` или `mon,17:00` — открыто в указанное время |
| `locale` | `ru_RU` |
| `region_id` | нужен, если нет гео-ограничений |

Альтернативы `point+radius`: прямоугольник `point1`/`point2`
(без `q` — не больше 2 км), `polygon` в WKT (без `q` — ~6 км²).

### Полезные `fields`

- `items.point` — координаты (без него маркер не поставить)
- `items.address`, `items.full_address_name`
- `items.rubrics`, `items.org`, `items.brand`
- `items.schedule` — часы работы
- `items.reviews` — рейтинг и отзывы
- `items.contact_groups` — телефоны/сайты (**требует отдельного разрешения ключа**)

### Пример: аптеки в 500 м от дома, ближайшие первыми

```
https://catalog.api.2gis.com/3.0/items
  ?q=аптека
  &type=branch
  &point=37.630866,55.752256
  &radius=500
  &location=37.630866,55.752256
  &sort=distance
  &fields=items.point,items.address,items.schedule,items.rubrics,items.reviews
  &page_size=20
  &locale=ru_RU
  &key=KEY
```

### Ответ

```json
{
  "meta": { "api_version": "3.0.XXXXX", "code": 200, "issue_date": "YYYYMMDD" },
  "result": {
    "total": 42,
    "items": [
      { "id": "…", "name": "…", "type": "branch", "address_name": "…",
        "point": { "lon": 37.63, "lat": 55.75 } }
    ]
  }
}
```

Ошибка приходит в `meta` (`code` ≠ 200, `error.message`). Коды: 400, 403
(ключ/права), 404 (ничего не найдено — это не сбой, показывать пустое
состояние), 408, 500.

### Прочие методы поиска

`/3.0/items/byphone`, `/bysite`, `/byfias` (по коду ФИАС — удобно, если дом
уже привязан к ФИАС), `/byitin`, `/bytradelicense`.

## Categories API — рубрики

```
https://catalog.api.2gis.com/2.0/catalog/rubric/search?q=аптеки&region_id=32&key=KEY
https://catalog.api.2gis.com/2.0/catalog/rubric/list?region_id=32&key=KEY
```

Для Ближайших мест (CONTEXT.md) разумно один раз найти ID нужных рубрик
(травмпункты, больницы, аптеки с `work_time=now`, МФЦ, ветклиники) и держать
их константами в `packages/shared`, а поиск делать по `rubric_id` + `point` +
`radius`. ID рубрик — это справочник, а не данные об организациях; но их
лучше тоже сверить с правилами, прежде чем фиксировать в коде.

## Как встроить в MaxTown (набросок)

1. `apps/api`: маршрут `GET /places?category=…` — берёт координаты
   дома из БД, зовёт Places API с серверным ключом на каждый запрос, **не
   кеширует** (ADR-0003), отдаёт нормализованный тип из `packages/shared`
   (`id, name, address, lon, lat, distance, schedule`). Закреплённые места —
   отдельно, из нашей базы.
2. `apps/miniapp`: адаптер загрузки MapGL, `PlacesScreen` — чипы категорий,
   карта с маркером дома и точками, список под картой. Тексты — на русском,
   стили — через токены `design/`.
3. Атрибуцию 2ГИС на карте не скрывать (условия использования).

## Открытые вопросы

- Лимиты демо-ключа и цена подписки на Places — уточнить в кабинете.
- Можно ли хранить хотя бы id организации (чтобы Староста скрывал неверное
  Ближайшее место) — спросить у 2ГИС.
- Нужен ли доступ к `items.contact_groups` (телефоны) — запрашивается отдельно.
- Работает ли MapGL (WebGL) во всех клиентах VK Mini Apps — проверить на
  Android/iOS WebView. Если WebGL нет, `isSupported()` вернёт false и
  мини-апп покажет списки без карты.
- MapGL 1.78 (`@2gis/mapgl`): у `HtmlMarker` нет своих событий — клики ловим
  на HTML-элементе метки.

## Проверено на живом ключе (2026-09-28, Санкт-Петербург)

- ID рубрик: Травмпункты 229, Больницы 201, Аптеки 207, Ветеринарные клиники 205,
  МФЦ 53505, Социальные службы 520, Фонды пенсионного и социального страхования
  112791, Налоговые инспекции 132, ЗАГСы 138, Пункты приёма 110523, Участковые
  пункты полиции 53244, Военкоматы 136, Женские консультации 649. Мирового
  судьи рубрики нет.
- Рубрика + `q` отсекает лишнее: `q=приёмное отделение` в «Больницах» даёт
  приёмные покои вместо частных медцентров; `q=круглосуточная аптека` — только
  аптеки 24/7; `q=приём батареек` — контейнеры для батареек и ламп, а не
  мусорные площадки.
- `schedule.is_24x7` приходит у круглосуточных мест; часы — по дням `Mon…Sun`
  с `working_hours: [{from, to}]`.
- `items.contact_groups` без отдельного разрешения ключа не приходит.
- С иностранного IP (VPN) 2ГИС не отвечает: подключение к
  `catalog.api.2gis.com` обрывается по тайм-ауту. Запросы к Places и геокодеру
  должны идти с российского IP; сервер на Render во Франкфурте для этого не
  подходит (docs/adr/0003).
- Геокодер `/3.0/items/geocode` понимает адрес с опечатками
  («Коменданский проспект 19к3»).
