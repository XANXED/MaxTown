# Промпты для Stitch: мини-апп MAX

Промпты написаны по-английски, потому что Stitch точнее следует английским
формулировкам. Описание приложения и экрана (`APP`, `SCREEN`) можно писать
по-русски, а весь текст в самих макетах будет на русском.

## Порядок работы

1. В Stitch создай новый проект в режиме **Mobile / App**.
2. Загрузи [DESIGN.md](DESIGN.md). По сторонним гайдам импорт находится в
   *Settings → Design System → Import DESIGN.md*, файл можно выбрать или
   вставить текстом. После импорта проверь образцы: primary `#007aff`, фон
   `#edeef2`, шрифт Roboto. Если такого пункта нет, начни с промпта 1Б: в нём
   сжатая версия той же системы.
3. Первый экран генерируй промптом **1А** (если DESIGN.md загружен) или **1Б**
   (если нет). Заполни `APP` и `SCREEN`.
4. Дальше вноси **одну правку за промпт** (промпты 2–8). Официальный гайд
   Stitch советует менять 1–2 вещи за раз, иначе он пересобирает экран
   целиком. Промпты длиннее ~5000 символов теряют компоненты: 1Б занимает
   около 3300, так что на `APP` и `SCREEN` остаётся примерно 1500 символов.
5. Понравившийся экран прогони как минимум в четырёх вариантах: светлый,
   тёмный (промпт 5), «Изящная» светлая и «Москва» тёмная (промпт 6).

Пример заполнения, чтобы понять нужную детальность:

> APP: запись к мастерам барбершопа прямо в MAX: клиент выбирает мастера,
> услугу и время.
> SCREEN: профиль мастера. Фото, имя, рейтинг и число отзывов, блок «О себе»,
> список услуг с ценой и длительностью, внизу закреплённая кнопка «Записаться».

---

## 1А. Первый экран, DESIGN.md загружен

```text
Design a mobile screen for a mini-app inside the MAX messenger. Follow the project design system "MAX Mini App" exactly: its colors, type scale, radii, spacing and component specs. Light scheme, MAX theme «Космос». All UI copy in Russian, real text, no lorem ipsum.

APP: <<что делает приложение и для кого>>
SCREEN: <<какой экран, что на нём, одно главное действие>>

Non-negotiable: MAX draws the top bar, so no second navbar. Flat layers: fill and 1px dividers, no shadows on cards, rows or buttons. Exactly one accent (#007aff) button; the rest are secondary (#e9ebf1) or text buttons. Roboto 400/500/600, never bold 700. List rows on white planes, uppercase 12px group headers, 16px side margins. Buttons are rounded rectangles (52px, radius 16), never pills. No gradients, glass or emoji icons.
```

## 1Б. Первый экран, без DESIGN.md (полная система в промпте)

```text
Design a mobile screen for a mini-app that runs inside MAX, the Russian messenger (same model as a Telegram Mini App). It must look like a native part of MAX, not a website: flat, calm, compact, content-first. All UI copy in Russian, real text.

APP: <<что делает приложение и для кого>>
SCREEN: <<какой экран, что на нём, одно главное действие>>

CANVAS: phone 360–412px wide, light scheme. MAX draws the top bar: show a plain white 56px bar with a back chevron and the title 17px/600; no logo, no shadow, no second navbar.

LAYERS, never shadows: backdrop #edeef2 → white planes #ffffff (list groups, sheets, bottom panel) → white cards, radius 16, set apart only by the grey gap → nested blocks #f5f7fa → translucent fill #0909090d (icon tiles, pressed rows). Dividers 1px #0c0d0e29.

ACCENT #007aff is scarce: only the ONE primary button, links, active tab, switch on, selected chip, unread badge, focused field. Never large fills or gradients. White on accent.

TEXT is one near-black with alphas, no other greys: #060708 main, #060708ad secondary, #06070885 captions and time, #06070866 placeholder. Icons #060708d6 / #060708a3 / #0607087a. Inactive tab #969699. Signals: success #1abe43, error #ff303c, warning #ff9315, yellow #ffcc00 only as a badge fill. No green or red main buttons (green = "accept call" in MAX).

TYPE: Roboto, weights 400 text / 500 buttons / 600 headings, never 700. Hero 28/32, header 24/28, subheader 20/24, title 17/24 (600); body 16/20, detail 15/20, caption 13/16, label 12/16 (400); button text 17/16/14/13 (500). Group headers: 12px/500 UPPERCASE, +0.5px tracking, #060708ad.

SPACING: 4px grid. Side margins and card padding 16, row padding 12, 8 between elements, 24 between sections.

SHAPES: radius grows with size (8, 10, 12, 16, 20). Buttons and fields are rounded rectangles, never pills. Avatars, FAB and switch thumbs are circles. Icons: outline, 2px stroke, 24px, rounded caps.

COMPONENTS
- Buttons: fill only, no border or shadow, text 500. 52px r16 default; 60px r20 large; 40px r12 small; 32px r8 xsmall. Primary #007aff + white, one per screen; secondary #e9ebf1 + #060708; destructive #ff303c + white with a clear word; text button #007aff. Full width only in a sticky bottom panel (white, 1px top divider). Disabled = 40% opacity.
- Fields: 40px r12 or 52px r16, fill #09090914, 1px border #9da4ac4d, #007aff on focus, #ff303c on error; uppercase label above, 13/16 hint below.
- Search: 40px r12, fill #09090914, 20px magnifier, no border.
- List rows (main block): min 56px, padding 16/12, optional 48px round avatar, name 17/600, second line 16 #060708ad, meta 13 #06070885 right, chevron only if it opens a screen, divider inset to the text. Rows share one white plane: no borders, no per-row cards.
- Chips: 32px r10, 14/500; off #f6f6f6, on #007aff + white; fill only; one scrolling row.
- Badge 20px pill #007aff, white digits. Switch on #007aff, off #09090914. Tab bar white, active #007aff.
- Sheet: white, top radius 20, dim #0c0d0e52. Only menus, popovers and FAB get a shadow: 0 4px 16px #0000004d.

DON'T: shadows on cards or rows, gradients, glassmorphism, glow, Material 3 tonal surfaces, bold 700, decorative fonts, emoji icons, colored left-border cards, a second accent button, fixed heights on text (MAX scales body text 12–24px).
```

---

## 2. Следующий экран того же приложения

```text
Add the next screen of the same app: <<какой экран и что на нём>>. Reuse the exact top bar, margins, type scale, list rows, buttons and colors of the existing screens. At most one accent button.
```

## 3. Сразу поток из нескольких экранов

Stitch умеет генерировать до пяти связанных экранов за раз.

```text
Generate this flow for the same app, one design system across all screens: 1) <<экран>> 2) <<экран>> 3) <<экран>>. Same top bar, margins, type and components on every screen; one accent button per screen at most.
```

## 4. Варианты раскладки для выбора

```text
Make 3 alternative layouts of this screen with the same content and the same design system: (A) grouped list: full-width white planes with 1px dividers and uppercase group headers; (B) inset cards: white cards with radius 16 on the #edeef2 backdrop, 16px side margins; (C) summary first: a compact key-info block on top, then a list. No new colors, no shadows.
```

## 5. Тёмная схема

Раскладка и акцент не меняются, меняются только цвета.

```text
Create the dark-scheme version of this screen. Layout, sizes and the accent #007aff stay the same; only colors change. Backdrop #0f0f12; planes, top bar and bottom panel #17181c; cards, nested blocks and chips #25262d; translucent fills, fields and switch-off #ffffff17; dim #0d0d0da3. Text #ffffff / #ffffffcc / #ffffffa3 / #ffffff66; icons #ffffff / #ffffffad / #ffffff85; dividers #ffffff1f; field border #ffffff29; secondary buttons #434455; error #ce4257 (error border #ff444f); success #2bc644; warning #ff9f0a; inactive tab #7d7d7f. Cards stay lighter than planes. Still no shadows.
```

## 6. Перекраска в темы MAX

Применяй к экрану в нужной схеме: светлую строку к светлому экрану, тёмную к
тёмному (сначала промпт 5). Значения взяты из `themes.css`. «Простая»,
«Аквамарин» и «Тадам» почти не отличаются от «Космоса» и здесь опущены; их
значения есть в таблице тем в DESIGN.md.

### Уверенная (`feb23`)

```text
Re-skin this screen to the MAX theme «Уверенная», light scheme. Accent #148a8e everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #edf2f2, nested blocks #f5f8f8, secondary buttons #e9f0f1. Near-black text becomes #060808: secondary #060808ad, captions #06080885, placeholders #06080866; icons #060808d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Уверенная», dark scheme. Accent #2e86a3. Screen background #141517, planes and top bar #121314, cards and nested blocks #202225, secondary buttons #3d4649, unselected chips #1d2020. Text stays white with the same alphas. Change nothing else.
```

### Изящная (`mar8`)

```text
Re-skin this screen to the MAX theme «Изящная», light scheme. Accent #d0538f everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #f2f0f2, nested blocks #f9f7f8, secondary buttons #f4ecf0. Near-black text becomes #080607: secondary #080607ad, captions #08060785, placeholders #08060766; icons #080607d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Изящная», dark scheme. Accent #cd3782. Screen background #171417, planes and top bar #141214, cards and nested blocks #252025, secondary buttons #4b3f47, unselected chips #201e1d. Text stays white with the same alphas. Change nothing else.
```

### Летний лес (`nature`)

```text
Re-skin this screen to the MAX theme «Летний лес», light scheme. Accent #2da334 everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #f0f2f0, nested blocks #f5faf5, secondary buttons #e9f1ea. Near-black text becomes #060806: secondary #060806ad, captions #06080685, placeholders #06080666; icons #060806d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Летний лес», dark scheme. Accent #2da334. Screen background #0f120f, planes and top bar #171c17, cards and nested blocks #222925, secondary buttons #414f44, unselected chips #222925. Text stays white with the same alphas. Change nothing else.
```

### Неон (`neon`)

```text
Re-skin this screen to the MAX theme «Неон», light scheme. Accent #5d3dff everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #f0f0f2, nested blocks #f6f5fa, secondary buttons #edecf4. Near-black text becomes #060608: secondary #060608ad, captions #06060885, placeholders #06060866; icons #060608d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Неон», dark scheme. Accent #6a4dff. Selected chips and badges stay #5d3dff. Screen background #100f12, planes and top bar #19171c, cards and nested blocks #28252d, secondary buttons #464357, unselected chips #28252d. Text stays white with the same alphas. Change nothing else.
```

### Москва (`moscow`)

```text
Re-skin this screen to the MAX theme «Москва», light scheme. Accent #d93636 everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #f2f0f0, nested blocks #faf8f7, secondary buttons #f3ebeb. Near-black text becomes #080606: secondary #080606ad, captions #08060685, placeholders #08060666; icons #080606d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Москва», dark scheme. Accent #a63a3a. Screen background #06090f, planes and top bar #0b101a, cards and nested blocks #111a29, secondary buttons #382e35, unselected chips #111a29. Text stays white with the same alphas. Change nothing else.
```

### Тема Студии Лебедева (`lebedev`)

```text
Re-skin this screen to the MAX theme «Тема Студии Лебедева», light scheme. Accent #de675a everywhere the accent is used (primary button, links, active tab, switch on, selected chip, badge, focus). Screen background #f2f1f0, nested blocks #faf8f5, secondary buttons #f6eeed. Near-black text becomes #080606: secondary #080606ad, captions #08060685, placeholders #08060666; icons #080606d6. Change nothing else.
```

```text
Re-skin this dark screen to the MAX theme «Тема Студии Лебедева», dark scheme. Accent #bb483f. Screen background #120f0f, planes and top bar #1c1817, cards and nested blocks #292422, secondary buttons #514542, unselected chips #292422. Text stays white with the same alphas. Change nothing else.
```

## 7. Свой фирменный акцент

Не бери зелёный, красный, жёлтый или оранжевый: в MAX это сигнальные цвета.
Белый текст на акценте должен читаться.

```text
Change the accent from #007aff to <<#HEX>> everywhere the accent is used: primary button, links and text buttons, active tab, switch on, selected chip, badge, focused field border, and the selected-row wash (<<#HEX>> at 16% opacity). Text on the accent stays white. Nothing else changes.
```

## 8. Исправления, если Stitch отошёл от системы

Один промпт на одну проблему.

```text
Remove every shadow from cards, rows, buttons and bars. Separate layers only by the #edeef2 backdrop and 1px #0c0d0e29 dividers.
```

```text
Keep exactly one accent-filled button on this screen. Turn the others into secondary buttons (#e9ebf1 fill, #060708 text) or text buttons.
```

```text
Make all buttons rounded rectangles: 52px tall with a 16px radius (small ones 40px with 12px). No pill shapes.
```

```text
Replace all bold 700 text: headings 600, buttons 500, body 400.
```

```text
Rebuild this list as MAX list rows: one white plane, 1px dividers inset to the text start, no per-row cards, borders or gaps.
```

```text
Secondary text must be #060708ad and captions #06070885. Replace every other grey used for text or icons.
```

```text
Remove gradients, glass and glow effects. Use flat fills from the palette only.
```

```text
Remove the custom navigation bar inside the page. Keep only the plain MAX top bar: back chevron and title.
```

```text
Switch all product copy and button text to natural, concise Russian.
```

---

## Перенос макета в код

Stitch отдаёт HTML на Tailwind с литералами цвета. В код их не переносим:
по таблице *Code names* в [DESIGN.md](DESIGN.md) каждое имя переводится в
переменную `tokens.css` (`surface` → `var(--background-primary)`,
`on-surface-secondary` → `var(--text-secondary)` и так далее). Правила
[AGENTS.md](../AGENTS.md) остаются в силе: только `var(--…)`, мобильная шкала
кнопок, без внешних шрифтов. Roboto в макетах только заменяет системный шрифт.
