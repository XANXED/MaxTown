---
version: alpha
name: MAX Mini App
description: Mini-app inside the MAX messenger. Default MAX theme «Космос» (Space), light scheme. Flat tonal layers, one scarce accent, system font, touch-sized controls.
colors:
  primary: "#007aff"
  on-primary: "#ffffff"
  primary-fade: "#007aff29"
  background: "#edeef2"
  surface: "#ffffff"
  surface-card: "#ffffff"
  surface-nested: "#f5f7fa"
  fill-translucent: "#0909090d"
  scrim: "#0c0d0e52"
  on-surface: "#060708"
  on-surface-secondary: "#060708ad"
  on-surface-tertiary: "#06070885"
  on-surface-mute: "#06070866"
  icon: "#060708d6"
  icon-secondary: "#060708a3"
  icon-tertiary: "#0607087a"
  icon-mute: "#06070847"
  divider: "#0c0d0e29"
  divider-subtle: "#0c0d0e0f"
  outline: "#9da4ac4d"
  error: "#ff303c"
  success: "#1abe43"
  warning: "#ff9315"
  attention: "#ffcc00"
  button-secondary: "#e9ebf1"
  button-overlay: "#0c0d0e52"
  input-fill: "#09090914"
  control-off: "#09090914"
  chip-off: "#f6f6f6"
  tab-inactive: "#969699"
typography:
  hero:
    fontFamily: Roboto
    fontSize: 28px
    fontWeight: 600
    lineHeight: 32px
  header:
    fontFamily: Roboto
    fontSize: 24px
    fontWeight: 600
    lineHeight: 28px
  subheader:
    fontFamily: Roboto
    fontSize: 20px
    fontWeight: 600
    lineHeight: 24px
  title:
    fontFamily: Roboto
    fontSize: 17px
    fontWeight: 600
    lineHeight: 24px
  body:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0.15px
  body-strong:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.15px
  detail:
    fontFamily: Roboto
    fontSize: 15px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0.15px
  detail-strong:
    fontFamily: Roboto
    fontSize: 15px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.15px
  description:
    fontFamily: Roboto
    fontSize: 13px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.2px
  label:
    fontFamily: Roboto
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.3px
  label-caps:
    fontFamily: Roboto
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.5px
  tag:
    fontFamily: Roboto
    fontSize: 11px
    fontWeight: 400
    lineHeight: 16px
  note:
    fontFamily: Roboto
    fontSize: 10px
    fontWeight: 400
    lineHeight: 12px
    letterSpacing: 0.3px
  action-large:
    fontFamily: Roboto
    fontSize: 17px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.15px
  action-medium:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.15px
  action-small:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.15px
  action-xsmall:
    fontFamily: Roboto
    fontSize: 13px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.15px
rounded:
  radius-4: 4px
  radius-8: 8px
  radius-10: 10px
  radius-12: 12px
  radius-16: 16px
  radius-20: 20px
  full: 9999px
spacing:
  space-2: 2px
  space-4: 4px
  space-6: 6px
  space-8: 8px
  space-10: 10px
  space-12: 12px
  space-16: 16px
  space-20: 20px
  space-24: 24px
  space-32: 32px
  screen-margin: 16px
  row-padding-y: 12px
  section-gap: 24px
components:
  top-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.title}"
    height: 56px
    padding: "{spacing.screen-margin}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.action-medium}"
    rounded: "{rounded.radius-16}"
    height: 52px
    padding: 20px
  button-secondary:
    backgroundColor: "{colors.button-secondary}"
    textColor: "{colors.on-surface}"
    typography: "{typography.action-medium}"
    rounded: "{rounded.radius-16}"
    height: 52px
    padding: 20px
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    typography: "{typography.action-medium}"
    rounded: "{rounded.radius-16}"
    height: 52px
    padding: 20px
  button-text:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.action-medium}"
    rounded: "{rounded.radius-16}"
    height: 52px
    padding: 20px
  button-overlay:
    backgroundColor: "{colors.button-overlay}"
    textColor: "{colors.on-primary}"
  button-large:
    typography: "{typography.action-large}"
    rounded: "{rounded.radius-20}"
    height: 60px
    padding: 22px
  button-small:
    typography: "{typography.action-small}"
    rounded: "{rounded.radius-12}"
    height: 40px
    padding: 12px
  button-xsmall:
    typography: "{typography.action-xsmall}"
    rounded: "{rounded.radius-8}"
    height: 32px
    padding: 12px
  text-field:
    backgroundColor: "{colors.input-fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-12}"
    height: 40px
    padding: 12px
  text-field-large:
    backgroundColor: "{colors.input-fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-16}"
    height: 52px
    padding: 16px
  field-label:
    textColor: "{colors.on-surface-secondary}"
    typography: "{typography.label-caps}"
  field-hint:
    textColor: "{colors.on-surface-tertiary}"
    typography: "{typography.description}"
  field-placeholder:
    textColor: "{colors.on-surface-mute}"
    typography: "{typography.body}"
  search-field:
    backgroundColor: "{colors.input-fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-12}"
    height: 40px
    padding: 12px
  group-header:
    textColor: "{colors.on-surface-secondary}"
    typography: "{typography.label-caps}"
    padding: "{spacing.screen-margin}"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    height: 56px
    padding: "{spacing.screen-margin}"
  list-row-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title}"
  list-row-subtitle:
    textColor: "{colors.on-surface-secondary}"
    typography: "{typography.body}"
  list-row-meta:
    textColor: "{colors.on-surface-tertiary}"
    typography: "{typography.description}"
  list-row-pressed:
    backgroundColor: "{colors.fill-translucent}"
  list-row-selected:
    backgroundColor: "{colors.primary-fade}"
  list-divider:
    backgroundColor: "{colors.divider}"
    height: 1px
  list-divider-subtle:
    backgroundColor: "{colors.divider-subtle}"
    height: 1px
  avatar:
    rounded: "{rounded.full}"
    size: 48px
  icon-tile:
    backgroundColor: "{colors.fill-translucent}"
    rounded: "{rounded.radius-12}"
  icon-default:
    textColor: "{colors.icon}"
    size: 24px
  icon-chevron:
    textColor: "{colors.icon-secondary}"
    size: 24px
  icon-decorative:
    textColor: "{colors.icon-tertiary}"
  icon-disabled:
    textColor: "{colors.icon-mute}"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.radius-16}"
    padding: "{spacing.space-16}"
  nested-block:
    backgroundColor: "{colors.surface-nested}"
    textColor: "{colors.on-surface}"
  bottom-panel:
    backgroundColor: "{colors.surface}"
    padding: "{spacing.screen-margin}"
  bottom-sheet:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.radius-20}"
    padding: "{spacing.space-16}"
  sheet-scrim:
    backgroundColor: "{colors.scrim}"
  menu:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
  chip:
    backgroundColor: "{colors.chip-off}"
    textColor: "{colors.on-surface}"
    typography: "{typography.action-small}"
    rounded: "{rounded.radius-10}"
    height: 32px
    padding: 12px
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.note}"
    rounded: "{rounded.radius-10}"
    height: 20px
  badge-attention:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
  dot-attention:
    backgroundColor: "{colors.attention}"
  status-success:
    textColor: "{colors.success}"
  status-warning:
    textColor: "{colors.warning}"
  switch-on:
    backgroundColor: "{colors.primary}"
  switch-off:
    backgroundColor: "{colors.control-off}"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tab-inactive}"
    typography: "{typography.label}"
  tab-bar-active:
    textColor: "{colors.primary}"
  link:
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  empty-state-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.hero}"
---

# MAX Mini App

## Overview

A mini-app that opens inside **MAX**, the Russian messenger (same model as a
Telegram Mini App). It must read as a native part of MAX, not as a website
placed inside it. Every value here is taken 1:1 from the working MAX web client
(web.max.ru) and the official `@maxhub/max-ui` 0.5.0 library. The baseline is
the default MAX theme «Космос» (Space), light scheme.

**Personality:** calm, utilitarian, compact, content-first. It is an everyday
messenger tool, not a landing page: lists, settings-style groups, short forms.
The accent is a scarce resource. Nothing decorative: no gradients, no glass, no
glow, no shadows on content, no illustrated backdrops.

**Context the design must respect:**

- Phones 360–412 px wide (Android 360/412, iOS 375/393), touch first.
  Components feel like native iOS/Android controls rather than Material 3 web:
  flat fills, rounded rectangles, no tonal elevation.
- MAX draws its own top bar with the back/close controls above the mini-app.
  The page never adds a second navigation bar with its own back arrow. In
  mockups, show that host bar as `top-bar`: a plain bar with a back chevron and
  the screen title.
- A mini-app cannot read the user's MAX theme, only light/dark from the OS.
  Design light first; dark is an equal, complete variant (Colors → Dark scheme).
- MAX has a 9-step text-size setting: body text goes from 12 to 24 px while
  headings stay 17 px and control heights stay fixed. Text containers never get
  fixed heights; text wraps.
- Copy is Russian, short, sentence case, real — no lorem ipsum. Error text says
  what is wrong and what to do: «Номер не дописан — нужно 11 цифр», not
  «Неверный формат».

## Colors

**Layers**, bottom to top. They are separated by fill and 1 px dividers, never
by shadows:

- **Backdrop** `background` #edeef2: cool light grey behind groups and cards;
  the page color of the mini-app.
- **Plane** `surface` #ffffff: top bar, full-width list groups, bottom panel.
- **Card** `surface-card` #ffffff: cards and modal sheets. In light it equals
  `surface`; a card is set apart by its radius and the grey gap around it, not
  by color and not by shadow.
- **Nested** `surface-nested` #f5f7fa: blocks inside a card, the track of a
  segmented control, unselected segments.
- **Translucent fill** `fill-translucent` #0909090d: works on any layer; icon
  tiles, pressed rows, skeletons.
- **Scrim** `scrim` #0c0d0e52: dim behind sheets and dialogs.

**Accent** `primary` #007aff (MAX calls it *accent*). It is used only for: the
one primary button, links and text buttons, the active tab, switches,
checkboxes and radios that are on, the selected chip, the unread badge, the
focus ring and the focused field border. `primary-fade` (#007aff29, the accent
at 16 %) is the wash of a selected row. Never fill large areas with the accent
and never build a gradient from it. Content on the accent is always white
(`on-primary`).

**Text** is one near-black with fixed alphas, never a separate grey:

- `on-surface` #060708: headings and body.
- `on-surface-secondary` #060708ad (68 %): subtitles, a row's second line,
  group headers, field labels.
- `on-surface-tertiary` #06070885 (52 %): timestamps, captions, hints.
- `on-surface-mute` #06070866 (40 %): placeholders and disabled text only; it
  never carries information.

**Icons** use the same near-black: `icon` #060708d6, `icon-secondary` #060708a3
(chevrons, secondary actions), `icon-tertiary` #0607087a (decorative and
empty-state icons), `icon-mute` #06070847 (disabled). The only opaque grey in
MAX is `tab-inactive` #969699.

**Lines:** `divider` #0c0d0e29 between list rows (the main separation tool);
`divider-subtle` #0c0d0e0f inside a group; `outline` #9da4ac4d is the resting
border of a text field.

**Signals** are identical in every MAX theme and are never the accent:

- `success` #1abe43: done, online, confirmed. A green main button means
  "accept call" in MAX, so there are no green CTAs.
- `error` #ff303c: errors, destructive buttons, error borders, mention badges.
- `warning` #ff9315: soft warnings.
- `attention` #ffcc00: yellow, only as a badge or icon fill; as text on light it
  is about 1.5:1.

**Controls:** `button-secondary` #e9ebf1 is opaque and slightly cool;
`input-fill` #09090914 is translucent so a field takes the tint of the layer
below; `control-off` #09090914 is a switch that is off or an empty slider
track; `chip-off` #f6f6f6 is an unselected chip; `button-overlay` #0c0d0e52 is
a button on top of a photo, with white text.

### Dark scheme

Same roles, new values. The accent stays #007aff and content on it stays white.
Cards (#25262d) are lighter than planes (#17181c): hierarchy reads by
lightness. Text alphas in dark are 100 / 80 / 64 / 40 %.

| Token | Dark value |
| --- | --- |
| background | #0f0f12 |
| surface | #17181c |
| surface-card, surface-nested, chip-off | #25262d |
| fill-translucent, input-fill, control-off | #ffffff17 |
| scrim | #0d0d0da3 |
| on-surface / secondary / tertiary / mute | #ffffff / #ffffffcc / #ffffffa3 / #ffffff66 |
| icon / secondary / tertiary / mute | #ffffff / #ffffffad / #ffffff85 / #ffffff5c |
| divider / divider-subtle | #ffffff1f / #ffffff0f |
| outline | #ffffff29 |
| button-secondary | #434455 |
| button-overlay | #2e333873 |
| error (text, fills) / error border | #ce4257 / #ff444f |
| success | #2bc644 |
| attention / warning | #ffd60a / #ff9f0a |
| tab-inactive | #7d7d7f |

### MAX themes

MAX users pick one of ten themes. A theme changes the accent, tints the
near-black text (every alpha step follows the new base, e.g. #080607ad), and
shifts the tone of the backdrop and of dark surfaces. Signals, alphas and all
geometry never change. Use this table to re-skin a screen or to pick a brand
accent without inventing a palette.

| Theme | Accent L / D | background L | surface-nested L | text base L | button-secondary L / D | background D | surface D | card D |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Космос (`space`), default | #007aff / #007aff | #edeef2 | #f5f7fa | #060708 | #e9ebf1 / #434455 | #0f0f12 | #17181c | #25262d |
| Уверенная (`feb23`) | #148a8e / #2e86a3 | #edf2f2 | #f5f8f8 | #060808 | #e9f0f1 / #3d4649 | #141517 | #121314 | #202225 |
| Изящная (`mar8`) | #d0538f / #cd3782 | #f2f0f2 | #f9f7f8 | #080607 | #f4ecf0 / #4b3f47 | #171417 | #141214 | #252025 |
| Летний лес (`nature`) | #2da334 / #2da334 | #f0f2f0 | #f5faf5 | #060806 | #e9f1ea / #414f44 | #0f120f | #171c17 | #222925 |
| Неон (`neon`) | #5d3dff / #6a4dff | #f0f0f2 | #f6f5fa | #060608 | #edecf4 / #464357 | #100f12 | #19171c | #28252d |
| Москва (`moscow`) | #d93636 / #a63a3a | #f2f0f0 | #faf8f7 | #080606 | #f3ebeb / #382e35 | #06090f | #0b101a | #111a29 |
| Тема Студии Лебедева (`lebedev`) | #de675a / #bb483f | #f2f1f0 | #faf8f5 | #080606 | #f6eeed / #514542 | #120f0f | #1c1817 | #292422 |
| Простая (`simple`) | #007aff / #007aff | #edeef2 | #f5f7fa | #060708 | #e9ebf1 / #323234 | #0f0f12 | #17181c | #25262d |
| Аквамарин (`aquamarine`) | #027feb / #027feb | #f0f1f2 | #f5f8fa | #060708 | #e9edf1 / #434d55 | #171c1b | #171c1b | #252d2b |
| Тадам (`tadam`) | #016fe7 / #016fe7 | #edeef2 | #f5f7fa | #060708 | #e9ebf1 / #434455 | #0f0f12 | #17181c | #25262d |

In «Неон» dark, selected chips and badges keep #5d3dff while the rest of the
accent is #6a4dff. Minimum review set for any screen: Космос light, Космос
dark, Изящная light (pink exposes hard-coded blue), Москва dark (red accent
next to error red on a blue-black plane).

### Code names

For handoff to code, the names above map to the project's `tokens.css`
variables. Code never copies hex values from a mockup; it uses these variables.

| DESIGN.md | tokens.css |
| --- | --- |
| primary | `--accent` and its roles `--button-primary`, `--text-themed`, `--icon-themed`, `--stroke-themed`, `--controls-active`, `--chips-active`, `--counter-themed`, `--tabbar-active` |
| on-primary | `--on-accent`, `--button-primary-contrast`, `--counter-contrast` |
| primary-fade | `--accent-fade` |
| background / surface / surface-card / surface-nested | `--background-surface` / `--background-primary` / `--background-card` / `--background-secondary` |
| fill-translucent / scrim | `--background-tertiary` / `--background-overlay` |
| on-surface / -secondary / -tertiary / -mute | `--text-primary` / `--text-secondary` / `--text-tertiary` / `--text-mute` |
| icon / -secondary / -tertiary / -mute | `--icon-primary` / `--icon-secondary` / `--icon-tertiary` / `--icon-mute` |
| divider / divider-subtle / outline | `--divider-primary` / `--divider-secondary` / `--stroke-tertiary` |
| error | `--text-negative`, `--button-negative`, `--stroke-negative`, `--counter-attention` |
| success / warning / attention | `--text-positive` / `--warning` / `--text-attention` |
| button-secondary / button-overlay | `--button-secondary` / `--button-overlay` |
| input-fill / control-off / chip-off / tab-inactive | `--input-background` / `--controls-inactive` / `--chips-default` / `--tabbar-inactive` |

## Typography

MAX uses the device system font (SF Pro on iOS, Roboto on Android) and never
loads web fonts. Mockups use **Roboto**. Letter-spacing values are Android's;
on iOS tracking is slightly negative.

Three weights only: **400** text, **500** buttons and emphasis, **600**
headings. MAX has no 700.

| Style | Size / line | Weight | Use |
| --- | --- | --- | --- |
| hero | 28 / 32 | 600 | Empty-state and onboarding title; the only size above 24 |
| header | 24 / 28 | 600 | Large screen title |
| subheader | 20 / 24 | 600 | Section title, sheet title |
| title | 17 / 24 | 600 | Top-bar title, name in a list row; the workhorse |
| body | 16 / 20 | 400 | Main text; the 20 px leading keeps lists compact |
| body-strong | 16 / 20 | 500 | Emphasis inside text |
| detail / detail-strong | 15 / 20 | 400 / 500 | Settings text, descriptions |
| description | 13 / 16 | 400 | Caption under an item, hint under a field, time |
| label | 12 / 16 | 400 | Tab labels, small tags |
| label-caps | 12 / 16, +0.5 px, UPPERCASE | 500 | Group header («ТЕМА ОФОРМЛЕНИЯ»); the signature MAX detail |
| tag | 11 / 16 | 400 | Tiny tag |
| note | 10 / 12 | 400 | Badge digits, labels on media |
| action-large / medium / small / xsmall | 17/20, 16/20, 14/20, 13/16 | 500 | Button text, by button size |

Only a list row's name and preview line may truncate to one line with an
ellipsis; all other text wraps.

## Layout & Spacing

- 4 px grid. Steps: 2, 4, 6, 8, 10, 12, 16, 20, 24, 32 (2 px steps up to 12,
  then 4 px).
- **16 px** side margins on every screen (`screen-margin`); also the inner
  padding of cards.
- **12 px** vertical padding in list rows (`row-padding-y`).
- **8 px** between neighbouring elements in a row, **20 px** between blocks
  inside a section, **24 px** between sections (`section-gap`), **32 px** above
  an empty state.
- Heights are multiples of 4: buttons 32 / 40 / 52 / 60, fields 40 / 52, rows
  from 56, top bar 56, avatar 48.
- Structure: backdrop → full-width list groups on `surface`, or inset cards
  (16 px side margins, radius 16) → rows separated by dividers.
- The primary action is either one inline button or sits in a sticky bottom
  panel: `surface`, a 1 px `divider` on top, 16 px margins, a full-width 52 px
  button. Buttons are full width only there.

## Elevation & Depth

Flat. Depth comes from tonal layers and 1 px dividers. Cards, list rows,
buttons, fields, the top bar and the tab bar have no shadow in any state.

The system has exactly one shadow, `elevation-float` =
`0 4px 16px #0000004d, 0 0 2px #0000004d`, and only floating layers get it:
context menus, popovers, the FAB. Sheets and dialogs sit on `scrim` instead.

## Shapes

Radius grows with the element, and height and radius are locked together:

- `radius-4`: small icons, file previews.
- `radius-8`: 32 px buttons, small cards, tooltips.
- `radius-10`: chips, 20 px badges.
- `radius-12`: 40 px buttons and fields, search, icon tiles.
- `radius-16`: 52 px buttons and fields, cards, grouped lists; the MAX
  signature.
- `radius-20`: 60 px buttons, top corners of bottom sheets, large cards.
- `full`: avatars, FAB, switch thumbs.

No square corners except full-screen planes. Buttons and fields are rounded
rectangles, never pills: a 52 px button with a 12 px or a full radius reads as
foreign.

Icons: outline style, 2 px stroke, 24 px grid, rounded caps and joins (20 px
inside search). They are colored with the `icon` tokens; the accent is only for
the active tab or a selected item.

## Components

**Top bar (drawn by MAX).** 56 px, `surface`, title in `title`, back chevron in
`icon`; no logo, no shadow. Never add a second bar below it.

**Buttons.** Fill only: no border, no shadow, text weight 500.

| Size | Height | Radius | Padding V / H | Text |
| --- | --- | --- | --- | --- |
| xsmall | 32 | 8 | 6 / 12 | action-xsmall, 13 |
| small | 40 | 12 | 10 / 12 | action-small, 14 |
| **medium (default)** | **52** | **16** | **16 / 20** | **action-medium, 16** |
| large | 60 | 20 | 18 / 22 | action-large, 17 |

Roles:

- **Primary:** `primary` + white. One per screen.
- **Secondary:** `button-secondary` + `on-surface`.
- **Destructive:** `error` + white, plus a clear word or icon. In «Москва» the
  accent and the error red are nearly the same.
- **Text:** no fill, `primary` text.
- **Overlay:** `button-overlay` + white, on photos.

Disabled is the whole button at 40 % opacity, not a grey fill. The focus ring is
`primary` with a 2 px offset. Desktop heights 28 / 48 are not used in
mini-apps.

**Text fields.** 40 px with radius 12 (medium) or 52 px with radius 16
(large); `input-fill`; a 1 px border that goes `outline` at rest → `primary` on
focus → `error` on error (the width never changes). Text in `body`, placeholder
in `on-surface-mute`. Label above in `label-caps`, `on-surface-secondary`;
hint below in `description`, `on-surface-tertiary` (`error` when invalid).
Never opaque, never shadowed.

**Search.** 40 px, radius 12, `input-fill`, a 20 px magnifier in
`icon-secondary` on the left with an 8 px gap, no border even when focused.

**List rows** are the core building block of MAX: settings, contacts,
catalogs, results.

- Min 56 px, grows with content; 16 px side and 12 px vertical padding.
- Leading: a 48 px circular avatar (photo, or initials on a colored circle) or
  an icon in a `fill-translucent` tile with radius 12; 12 px gap to the text.
- Name in `title` (people, objects) or `body` (plain settings rows); second
  line in `body`, `on-surface-secondary`; meta on the right in `description`,
  `on-surface-tertiary`.
- Trailing: a switch, a badge, a value, or a 24 px chevron in
  `icon-secondary`. The chevron appears only when the row opens another screen.
- A 1 px `divider` inset to where the text starts (76 px with an avatar),
  never under the avatar.
- Rows share one `surface` plane: no borders, no per-row cards, no gaps between
  rows. Pressed = `fill-translucent`; selected = `primary-fade`.
- A group is titled by a `label-caps` header in `on-surface-secondary` above
  the plane, 16 px from the edge.

**Cards.** `surface-card`, radius 16, 16 px padding, no border, no shadow, on
the `background` backdrop with 16 px side margins.

**Chips.** 32 px, radius 10, 12 px side padding, `action-small`. Off:
`chip-off` + `on-surface`; on: `primary` + white. Selection is shown by fill
only: no border, no check mark, no weight change. 8 px gaps; one horizontally
scrolling row, never wrapped. A count inside a chip is 12 px at 70 % opacity. A
screen with chips has already spent its accent on the selected chip: don't put
an accent button next to them.

**Badges.** 20 px pill (radius 10), min width 20; `primary` fill with white
`note` digits; `error` for mentions and failures; `attention` only as a fill.

**Selection controls.** Switch on in `primary`, off in `control-off`, with a
white round thumb. Checkbox and radio selected in `primary`. Slider: the filled
part in `primary`, the rest in `control-off`.

**Tab bar** (optional bottom navigation). `surface` with a 1 px `divider` on
top; 24 px outline icons with `label` captions; active in `primary`, inactive
in `tab-inactive`.

**Bottom sheets and dialogs.** `surface-card`, radius 20 on the top corners,
`scrim` behind; title in `subheader`; actions follow the button rules.

**Menus and popovers.** `surface-card` with `elevation-float`, the only
shadowed elements. Destructive items in `error`.

**Empty state.** Centered, 32 px below the top of the content: a large outline
icon in `icon-tertiary`, a `hero` title, one or two lines of `body` in
`on-surface-secondary`, one button.

**Messages** (only if the app shows a conversation). Bubbles: radius 16,
padding 8 / 12, at most 72 % of the width, text 16 / 20 without tracking, time
12 / 16 at the bottom right. Light: incoming #ffffff with #060708 text;
outgoing #e9fdff with #011c29 text, time and links #0784b8. Dark: incoming
#232e3a with white text; outgoing is a top-to-bottom gradient
#8849b4 → #735acd → #5d6ae5 with white text. That is the only gradient in the
system and it is never reused elsewhere.

## Do's and Don'ts

- Do keep exactly one accent-filled button per screen; everything else is a
  secondary or a text button.
- Do build screens from list rows on white planes with 1 px dividers, grouped
  under uppercase `label-caps` headers.
- Do keep 16 px side margins and every height on the 4 px grid.
- Do make secondary text an alpha of the near-black; let text wrap and leave
  room for body text up to 24 px.
- Do mark destructive actions with a word or an icon, not only with red.
- Don't put shadows on cards, rows, buttons, fields or bars; layers are
  separated by fill and dividers.
- Don't use gradients, glassmorphism, blur, glow, neon, 3D, colored left-border
  cards or emoji as icons.
- Don't use pill-shaped buttons or fields, square cards, or Material 3 tonal
  surfaces.
- Don't use weight 700 / bold, display or decorative fonts, or web fonts.
- Don't use signal colors (green, red, yellow, orange) as the brand accent;
  green means "accept call".
- Don't add separate grey hex values for text or icons.
- Don't set the `attention` yellow as text on light backgrounds.
- Don't give text containers fixed heights, and don't truncate anything except
  a list row's lines.
- Don't use desktop button heights 28 / 48 or mismatch height and radius.
- Don't draw a second custom navigation bar under the MAX top bar.
- Don't mix dark-scheme values into light screens or the other way round.
