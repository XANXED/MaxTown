# Как работать с токенами оформления

Инструкция для ИИ-агента, который пишет код в этом проекте. Проект — мини-апп
для мессенджера MAX.

> Файлы лежат в `design/`. В приложениях `apps/*` они подключаются через
> алиас Vite `@design`: `import '@design/tokens.css'`. Макеты и промпты для
> Stitch — в `design/stitch/`.

| Файл | Что | Подключать |
| --- | --- | --- |
| `tokens.css` | база: тема «Космос» (в MAX по умолчанию), 314 строк | всегда, **первым** |
| `themes.css` | девять остальных тем MAX, 839 строк | только если нужны темы, **после** `tokens.css` |

Значения сняты с работающего клиента `web.max.ru` и сверены с официальной
документацией и библиотекой `@maxhub/max-ui@0.5.0` (см. «Сверено с
документацией» в конце).

## Сначала реши: React или нет

Это первая развилка, она определяет всё остальное.

**Если проект на React — ставь `@maxhub/max-ui`.** Библиотека
самодостаточна: она объявляет 96 цветовых и 95 геометрических переменных
сама, на классах своего провайдера (`.MaxUI_colorScheme_light`,
`.MaxUI_platform_ios` и т. д.), плюс 56 токенов состояний
(`--states-button-primary-hover` и подобные), которых в `tokens.css` нет.
Её компоненты мимикрируют под нативные iOS и Android.

```jsx
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';

<MaxUI>            {/* платформа и схема определяются автоматически */}
  <App />
</MaxUI>
```

Компоненты: `Avatar.*`, `Button`, `CellAction`, `CellHeader`, `CellInput`,
`CellList`, `CellSimple`, `Container`, `Counter`, `Dot`, `EllipsisText`,
`Flex`, `Grid`, `IconButton`, `Input`, `Panel`, `Ripple`, `SearchInput`,
`Spinner`, `Switch`, `Textarea`, `ToolButton`, `Typography.*`.
Справка по каждому: `https://dev.max.ru/ui/components/<Имя>`.

**Если проект не на React** (vanilla, Vue, Svelte) — библиотеки нет, и тогда
работают `tokens.css` и `themes.css`. Они же нужны, если требуется палитра
десктопного клиента или темы оформления: **в библиотеке тем нет вообще**, там
только светлая и тёмная схемы.

## Правило номер один

> В этом проекте **не пишут литералы**. Ни цвет, ни размер шрифта, ни радиус,
> ни отступ. Всё через `var(--…)`.

```css
/* нет */                          /* да */
color: #060708;                    color: var(--text-primary);
background: #007aff;               background: var(--button-primary);
border-radius: 16px;               border-radius: var(--radius-16);
padding: 12px 16px;                padding: var(--space-12) var(--space-16);
font-size: 16px;                   font-size: var(--font-size-body);
```

Исключения — только то, что не выражается токенами: `border-width: 1px`,
`opacity`, проценты ширины, `flex` и `grid`.

Отдельно про «почти чёрный»: не подставляй `#060708` даже как «нейтральный».
В MAX базовый цвет текста **подкрашен темой** — `#060808` в «Уверенной»,
`#080607` в «Изящной», `#060806` в «Летнем лесу». Только `var(--text-primary)`.

## Порядок подключения

```html
<script src="https://st.max.ru/js/max-web-app.js"></script>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="themes.css">   <!-- опционально -->
```

**Вызывать `WebApp.ready()` не нужно** — такого метода в API нет.
Документация прямо говорит: объект создаётся с каждым запуском, предзагружает
данные и не требует отдельной инициализации, методы доступны напрямую.

## Что умеет window.WebApp

Полный список по документации — тем в нём нет (см. следующий раздел):

| Группа | Члены |
| --- | --- |
| Инициализация | `initData`, `initDataUnsafe`, `platform`, `version`, `deviceName`, `getLaunchContext` |
| Интерфейс | `getViewportSize`, `BackButton.{show,hide,isVisible,onClick,offClick}`, `enableClosingConfirmation`, `disableClosingConfirmation` |
| Экран | `requestScreenMaxBrightness`, `restoreScreenBrightness`, `ScreenCapture.{enableScreenCapture,disableScreenCapture}` |
| Хранилище | `DeviceStorage.*`, `SecureStorage.*` (оба: `setItem`, `getItem`, `removeItem`, `clear`) |
| Ссылки и шеринг | `openLink`, `openMaxLink`, `downloadFile`, `shareContent`, `shareMaxContent`, `requestContact`, `openCodeReader` |
| Устройство | `HapticFeedback.*`, `BiometricManager.*`, `NfcManager.*` |

`initDataUnsafe` **нельзя** использовать для проверки подлинности — для этого
`initData` валидируется на сервере: `https://dev.max.ru/docs/webapps/validation`.

## Тему хост не передаёт

Мини-апп **не может узнать**, какую тему выбрал пользователь. В документации
`window.WebApp` нет ни `colorScheme`, ни `themeParams`, ни события
`themeChanged` — проверено по полному списку членов объекта, не по пересказу.

Цветовую схему ловит только `prefers-color-scheme` — так её определяет и сам
`@maxhub/max-ui` (в его `dist/index.js` два обращения к этому медиазапросу и
ни одного к атрибутам хоста).

Поэтому `themes.css` нужен для трёх вещей, и ни одна из них не «подстроиться
под хост»:

1. дать пользователю выбор темы внутри приложения, как в самом MAX;
2. взять одну из тем как фирменную, не выдумывая палитру;
3. **прогнать интерфейс по всем акцентам и найти зашитые цвета.**

## Геометрия: два разных масштаба

Это главная ловушка. Десктопный клиент и мобильная библиотека используют
**разные размеры кнопок**. Для мини-аппа авторитетна библиотека — её сетка
рассчитана на палец.

**Мини-апп (значения `@maxhub/max-ui`, используй эти):**

| `size` | Высота | Радиус | Отступы | Текст |
| --- | --- | --- | --- | --- |
| `xsmall` | 32px | `--radius-8` | 6 / 12 | `--font-size-action-xsmall` |
| `small` | 40px | `--radius-12` | 10 / 12 | `--font-size-action-small` |
| `medium` | 52px | `--radius-16` | 16 / 20 | `--font-size-action-medium` |
| `large` | 60px | `--radius-20` | 18 / 22 | `--font-size-action-large` |

Поля ввода и ячейки идут по другой шкале: `Input` medium 40px с
`--radius-12`, large 52px с `--radius-16`.

**Десктопный клиент (для справки, не для мини-аппа):** 28 / 32 / 40 / 48 с
радиусами 10 / 12 / 16.

Общее для обоих: поля экрана по горизонтали `--space-16`, вертикальный
отступ ячейки `--space-12`, между секциями `--space-24`. Опорные ширины
экрана в библиотеке — 360/412px для Android, 375/393px для iOS.

## Типографика

Размеры, межстрочные и начертания **совпадают** в клиенте и библиотеке —
здесь расхождений нет:

`hero` 28/32/600 · `header` 24/28/600 · `subheader` 20/24/600 ·
`title` 17/24/600 · `body` 16/20/400 · `detail` 15/20/400 ·
`description` 13/16/400 · `label` 12/16/400 · `tag` 11/16/400 ·
`note` 10/12/400 · `action-large` 17/20/500 · `action-medium` 16/20/500 ·
`action-small` 14/20/500 · `action-xsmall` 13/16/500

Применяй группой:

```css
.cardTitle {
  font-size:   var(--font-size-title);
  line-height: var(--line-height-title);
  font-weight: var(--font-weight-title);
}
```

Весов ровно три: **400** текст, **500** кнопки и выделение, **600**
заголовки. Веса 700 в MAX нет — не ставь `bold`.

**Трекинг зависит от платформы.** У iOS он отрицательный, у Android
положительный: `body` — `-0.31px` против `+0.15px`, `title` — `-0.43px`
против `0`. Значения в `tokens.css` взяты из веб-клиента и совпадают с
**Android**. Если делаешь свою типографику под iOS — сдвигай трекинг в минус,
либо не задавай его вовсе.

Шрифт тоже платформенный: `-apple-system, system-ui, "Helvetica Neue",
Roboto, sans-serif` на iOS и просто `Roboto, sans-serif` на Android. В
`tokens.css` лежит стек веб-клиента, он безопасен для обоих. Внешние шрифты
не подключай.

`label-caps` (12px, вес 500, трекинг 0.5px, `uppercase`) — заголовок группы
настроек, характерная деталь MAX. В библиотеке этот стиль называется
`cell-label-strong-small-caps`.

## Два словаря имён

Цвета называются одинаково, остальное — нет. Не смешивай.

| Что | `tokens.css` (веб-клиент) | `@maxhub/max-ui` |
| --- | --- | --- |
| Цвета | `--text-primary`, `--icon-tertiary` | те же имена |
| Размер шрифта | `--font-size-body` | `--font-size-body` |
| Семейство | `--font-sans` | `--family-base`, `--family-headers` |
| Радиус | `--radius-16` | `--size-border-radius-button-medium` |
| Отступ | `--space-12` | `--spacing-size-xl` |

Цветовые значения сверены поштучно: из 39 общих токенов 24 совпадают побайтно,
остальные 15 различаются только записью (`rgba(12,13,14,.16)` против
`#0c0d0e29` — это один цвет). **Расхождений по цвету нет.**

## Структура tokens.css

| Блок | Селектор | Что внутри |
| --- | --- | --- |
| База | `:root` | `--accent` + 8 ролей, 70 цветов светлой схемы, типографика, отступы, радиусы, тень |
| Авто-тёмная | `@media (prefers-color-scheme: dark) { :root:not([data-color-scheme="light"]) }` | 52 переопределения |
| Принудительно тёмная | `:root[data-color-scheme="dark"]` | те же 52 |

`:not([data-color-scheme="light"])` в медиазапросе позволяет принудительно
включить светлую тему на тёмной ОС. Без него переключатель работал бы только
в одну сторону.

## Специфичность: не трогай селекторы

```
(0,1,0)  :root                                    tokens.css   светлая база
(0,1,0)  [data-color-theme="neon"]                themes.css   светлая тема   ← позже, выигрывает
(0,2,0)  :root:not([data-color-scheme="light"])   tokens.css   тёмная база
(0,2,0)  [data-color-theme="neon"]:not(…)         themes.css   тёмная тема    ← позже, выигрывает
(0,2,0)  :root[data-color-scheme="dark"]          tokens.css   тёмная явно
(0,2,0)  [data-color-theme="neon"][data-…="dark"] themes.css   тёмная явно    ← позже, выигрывает
```

Базовые блоки квалифицированы через `:root`, чтобы тёмная схема (0,2,0) не
проигрывала светлому блоку темы (0,1,0). Припишешь теме `:root` или снимешь
его с базы — светлая тема начнёт перебивать тёмную схему.

Каскад проверен в браузере на девяти состояниях. Менял селекторы — перепроверь.

## Темы MAX

Переключение атрибутом на `<html>`:

```js
document.documentElement.setAttribute('data-color-theme', 'neon');
document.documentElement.removeAttribute('data-color-theme');  // обратно в «Космос»
```

| `data-color-theme` | Название в MAX | Акцент светлой | Акцент тёмной | Меняет токенов |
| --- | --- | --- | --- | --- |
| *(не задан)* | Космос | `#007aff` | `#007aff` | база |
| `feb23` | Уверенная | `#148a8e` | `#2e86a3` | 37 / 28 |
| `mar8` | Изящная | `#d0538f` | `#cd3782` | 38 / 31 |
| `nature` | Летний лес | `#2da334` | `#2da334` | 37 / 28 |
| `neon` | Неон | `#5d3dff` | `#6a4dff` | 37 / 28 |
| `moscow` | Москва | `#d93636` | `#a63a3a` | 37 / 29 |
| `lebedev` | Тема Студии Лебедева | `#de675a` | `#bb483f` | 37 / 29 |
| `simple` | Простая | `#007aff` | `#007aff` | 9 / 8 |
| `aquamarine` | Аквамарин | `#027feb` | `#027feb` | 28 / 27 |
| `tadam` | Тадам | `#016fe7` | `#016fe7` | 16 / 14 |

`space` отдельного блока не имеет — это и есть база, поэтому
`data-color-theme="space"` корректно отдаёт значения по умолчанию.

Тема меняет не только акцент: подтон тёмных поверхностей («Москва» уходит в
синий `#0b101a`, «Летний лес» в зелёный `#171c17`), подтон текста, вторичную
кнопку, обои чата и пузыри. Сигнальные цвета, прозрачности и вся геометрия —
не меняются никогда.

### Два режима работы

**Режим А — свой бренд (по умолчанию).** Только `tokens.css`, меняешь одну
строку:

```css
:root { --accent: #7a3cff; --accent-fade: #7a3cff29; }
```

Восемь ролей — `--text-themed`, `--icon-themed`, `--stroke-themed`,
`--button-primary`, `--controls-active`, `--counter-themed`, `--chips-active`,
`--tabbar-active` — объявлены как `var(--accent)` и подхватят цвет сами.
**Никогда не присваивай роли литерал.**

**Режим Б — темы MAX.** Подключаешь `themes.css` и ставишь
`data-color-theme`. Роли там заданы литералами, и это не ошибка: в MAX они не
всегда равны акценту — в «Неоне» тёмной `--accent` равен `#6a4dff`, а
`--chips-active` и `--counter-themed` остаются `#5d3dff`.

## Что брать под задачу

| Нужно | Токен |
| --- | --- |
| Фон экрана | `--background-surface` |
| Фон плоскости, шапки, листа | `--background-primary` |
| Фон карточки | `--background-card` |
| Фон вложенного блока | `--background-secondary` |
| Заливка поверх чего угодно | `--background-tertiary` |
| Затемнение под модалкой | `--background-overlay` |
| Основной текст | `--text-primary` |
| Второстепенный текст | `--text-secondary` |
| Время, подписи | `--text-tertiary` |
| Плейсхолдер, выключенный текст | `--text-mute` |
| Ссылка, текстовая кнопка | `--text-themed` |
| Успех / ошибка / внимание | `--text-positive` / `--text-negative` / `--text-attention` |
| Иконка основная / второстепенная | `--icon-primary` / `--icon-secondary` |
| Разделитель между строками списка | `--divider-primary` |
| Обводка поля: покой / фокус / ошибка | `--stroke-tertiary` / `--stroke-themed` / `--stroke-negative` |
| Главная кнопка | `--button-primary` + `--button-primary-contrast` |
| Вторичная кнопка | `--button-secondary` + `--text-primary` |
| Деструктивная кнопка | `--button-negative` + `--button-primary-contrast` |
| Кнопка поверх фото | `--button-overlay` + `--text-primary-inverse-static` |
| Поле ввода | `--input-background` |
| Чип: невыбранный / выбранный | `--chips-default` / `--chips-active` + `--on-accent` |
| Бейдж непрочитанных | `--counter-themed` + `--counter-contrast` |
| Переключатель вкл / выкл | `--controls-active` / `--controls-inactive` |
| Тень всплывающего слоя | `--elevation-float` |

## Жёсткие запреты

1. **Не зашивай цвета.** Ни `#007aff`, ни «почти чёрный», ни серый.
2. **Не вешай тень на карточки.** В MAX её там нет: слои разделяются заливкой
   и `--divider-primary`. `--elevation-float` — только меню, поповеры, FAB.
3. **Не подключай внешние шрифты.** Только системный стек.
4. **Не задавай фиксированную высоту блокам с текстом.** В MAX ползунок
   размера текста на девять делений: `body` ходит от 12px до 24px, заголовки
   остаются 17px.
5. **Не используй сигнальные цвета как акцент.** Зелёная главная кнопка в MAX
   означает «принять звонок».
6. **Не крась второстепенный текст отдельным серым** — это альфа основного.
7. **Не ставь `--text-attention` (жёлтый) текстом на светлом фоне** —
   контраст около 1.7:1. Он для заливки значка.
8. **Не бери десктопные высоты кнопок** (28/32/40/48) для мини-аппа — см.
   «Геометрия».
9. **Не вызывай `WebApp.ready()`** — такого метода нет.
10. **Не правь селекторы** в `tokens.css` и `themes.css`.

## Если нужного токена нет

Не выдумывай значение. По порядку:

1. Поищи в `tokens.css` — там 72 цвета, многие неочевидно названы
   (`--counter-mirage`, `--promo-text`, `--bubble-link`).
2. Посмотри в `@maxhub/max-ui/dist/styles.css`: там 96 цветовых токенов,
   включая 56 состояний (`--states-button-primary-hover`,
   `--states-text-primary-disabled` и т. д.), `--icon-quaternary`,
   `--gradients-loading-icon-*`. В `tokens.css` состояний нет — если делаешь
   свои интерактивные компоненты, значения берутся оттуда.
3. Собери из существующих: альфа поверх `--text-primary`,
   `--background-tertiary` поверх любой поверхности.
4. Добавляя в `tokens.css`, впиши во все три блока схем и оставь комментарий,
   откуда значение.

## Самопроверка перед сдачей

Запускать из корня репозитория в bash (в zsh `$INC` не разобьётся на слова):

```bash
SRC='apps packages'
SKIP='--exclude-dir=node_modules --exclude-dir=dist'
INC="--include=*.css --include=*.html --include=*.ts*"

grep -rn $SKIP '#[0-9a-fA-F]\{3,8\}' $INC $SRC                 # 1. литералы цвета
grep -rn $SKIP 'border-radius:\s*[0-9]' --include='*.css' $SRC  # 2. пиксели в радиусах
grep -rn $SKIP 'fonts.googleapis\|@font-face' $INC $SRC         # 3. внешние шрифты
grep -rn $SKIP 'font-weight:\s*\(700\|bold\)' --include='*.css' $SRC  # 4. вес 700
grep -rn $SKIP 'WebApp\.ready\|WebApp\.expand' --include='*.ts*' --include='*.js*' $SRC  # 5. несуществующие методы
```

Все пять должны быть пустыми.

Визуально: светлая и тёмная схема ОС без правок кода; системный шрифт на
максимум; на экране **ровно одна акцентная кнопка**. Прогон по темам:

```js
for (const t of ['neon','mar8','moscow','nature','lebedev','simple']) {
  document.documentElement.setAttribute('data-color-theme', t);
}
```

«Изящная» (розовая) и «Москва» (красная) ловят почти всё.

## Сверено с документацией

Проверено 21 сентября 2026 года по сырым страницам, а не по пересказу:

- `https://dev.max.ru/docs/webapps/bridge` — полный список членов
  `window.WebApp`; темы в API нет, `ready()` нет
- `https://dev.max.ru/docs/webapps/introduction` — подключение, диплинки, payload
- `https://dev.max.ru/docs/webapps/validation` — проверка `initData` на сервере
- `https://dev.max.ru/ui` и `https://dev.max.ru/ui/components/<Имя>` — библиотека
- `@maxhub/max-ui@0.5.0`, `dist/styles.css` и `dist/index.js` — значения токенов
- `https://dev.max.ru/docs/legal/requirements` — требования к содержанию
  приложений (правовые, не дизайнерские)

Официальный гайдлайн по интерфейсу, навигации и типографике публикуется в
формате Figma:
`https://github.com/max-messenger/max-ui/blob/main/MAXUI-Figma.fig`.
**Он не сверялся** — бинарный .fig, из текста его не прочитать. Если что-то в
макете расходится с этим файлом, прав макет.

## Полный дизайн-кит

Бренд-бук, разбор компонентов с живыми превью, пояснение к каждому токену:
https://claude.ai/artifact/WMtreNyjtDSr8SDjx956hP
