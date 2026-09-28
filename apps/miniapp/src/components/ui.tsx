import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import {
  CaretRight,
  CloudSlash,
  FileText,
  House,
  Megaphone,
  SquaresFour,
  User,
  Warning,
  CalendarBlank,
} from '@phosphor-icons/react';
import { Button, Counter, Typography } from './platform-ui.tsx';
import { categoryVisual } from './categoryVisuals.ts';
import type { HouseEventKind, HouseEventSummary, RequestSummary } from '@maxtown/shared';
import {
  formatUpdatedAt,
  houseEventKindLabels,
  requestStatusLabels,
  requestStatusTones,
} from '../data/labels.ts';
import { ROUTES, type AppRoute } from '../routes.ts';
import { useHomeData } from '../data/home.ts';
import type { Navigate } from '../screens/types.ts';

export type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean;
  weight?: 'regular' | 'bold' | 'fill' | 'duotone';
}>;

/**
 * Цвет плитки из палитры --tile-* (design/tokens.css): залитая иконка этого
 * цвета на подложке того же тона. Один сервис — один цвет на всех экранах,
 * см. serviceVisuals.ts.
 */
export type TileColor = 'blue' | 'teal' | 'green' | 'pink' | 'coral';

function iconWeight(tone: TileTone): 'regular' | 'fill' {
  return tone === 'neutral' ? 'regular' : 'fill';
}

/** neutral — серая плитка; danger — сигнальная, только для Аварии. */
export type TileTone = 'neutral' | 'danger' | TileColor;

type IconTileProps = {
  icon: IconComponent;
  tone?: TileTone;
  size?: 'small' | 'medium' | 'large';
};

export function IconTile({ icon: Icon, tone = 'neutral', size = 'medium' }: IconTileProps) {
  return (
    <span className={`icon-tile icon-tile--${tone} icon-tile--${size}`}>
      <Icon className="icon" weight={iconWeight(tone)} aria-hidden />
    </span>
  );
}

/** Маленькая плитка 20px для чипов: Системы в Состоянии дома, Категории в форме. */
export function MiniTile({ icon: Icon, tone }: { icon: IconComponent; tone: TileTone }) {
  return (
    <span className={`mini-tile icon-tile--${tone}`}>
      <Icon className="icon icon--small" weight={iconWeight(tone)} aria-hidden />
    </span>
  );
}

type Option<T extends string> = { value: T; label: string; count?: number };

type ChoiceProps<T extends string> = {
  label: string;
  options: Array<Option<T>>;
  value: T;
  onChange: (value: T) => void;
};

/** Фильтр списка: чипы в одну прокручиваемую строку, с числом элементов. */
export function FilterChips<T extends string>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          className={`chip pressable${option.value === value ? ' chip--selected' : ''}`}
          type="button"
          aria-pressed={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? <span className="chip__count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Выбор одного из двух-трёх вариантов: подложка с бегунком. */
export function Segmented<T extends string>({ label, options, value, onChange }: ChoiceProps<T>) {
  const index = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );

  // Как у группы радиокнопок: в Tab попадает только выбранный вариант, стрелки меняют выбор.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const option = next === null ? undefined : options[next];
    if (!option) return;
    event.preventDefault();
    onChange(option.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next ?? 0]?.focus();
  };

  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      data-count={options.length}
      data-index={index}
      onKeyDown={onKeyDown}
    >
      <span className="segmented__thumb" aria-hidden />
      {options.map((option) => (
        <button
          className="segmented__option"
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type SectionHeadingProps = {
  id?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeading({ id, title, actionLabel, onAction }: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <Typography.Text asChild variant="subheader">
        <h2 id={id}>{title}</h2>
      </Typography.Text>
      {actionLabel && onAction ? (
        <button className="text-action pressable" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ScreenHeading({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <header className="screen-heading">
      <Typography.Text asChild variant="header">
        <h1>{children}</h1>
      </Typography.Text>
      {description ? (
        <Typography.Text asChild variant="detail" color="secondary">
          <p>{description}</p>
        </Typography.Text>
      ) : null}
    </header>
  );
}

type EmptyStateProps = {
  icon: IconComponent;
  tone?: 'neutral' | TileColor;
  title: string;
  description: string;
  action?: ReactNode;
};

/** Пустой раздел: объясняет, что здесь появится, и чем заняться прямо сейчас. */
export function EmptyState({ icon: Icon, tone = 'neutral', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className={`empty-state__icon icon-tile--${tone}`}>
        <Icon className="icon" weight={iconWeight(tone)} aria-hidden />
      </span>
      <Typography.Text asChild variant="body-strong">
        <p>{title}</p>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p className="empty-state__description">{description}</p>
      </Typography.Text>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

type InlineEmptyProps = {
  icon: IconComponent;
  tone: TileTone;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Компактное пустое состояние в одну строку — для превью разделов на главной. */
export function InlineEmpty({ icon, tone, title, description, actionLabel, onAction }: InlineEmptyProps) {
  const content = (
    <>
      <IconTile icon={icon} tone={tone} size="small" />
      <span className="list-row__copy">
        <Typography.Text asChild variant="body-strong">
          <span>{title}</span>
        </Typography.Text>
        <Typography.Text asChild variant="description" color="secondary">
          <span>{description}</span>
        </Typography.Text>
      </span>
    </>
  );

  if (!onAction) return <div className="list-row list-row--compact">{content}</div>;

  return (
    <button className="list-row list-row--compact list-row--interactive" type="button" onClick={onAction}>
      {content}
      <span className="row-link">{actionLabel}</span>
    </button>
  );
}

const ERROR_TITLE = 'Не удалось загрузить';
const ERROR_DESCRIPTION = 'Проверьте интернет и попробуйте ещё раз';

/** Загрузка не удалась: объясняет и даёт повторить. Кнопка вторичная — акцент экрана не отнимает. */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="list-card" role="alert">
      <EmptyState
        icon={CloudSlash}
        title={ERROR_TITLE}
        description={ERROR_DESCRIPTION}
        action={
          <Button size="small" variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        }
      />
    </div>
  );
}

/** То же в одну строку — для превью разделов на главной. */
export function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="list-card" role="alert">
      <InlineEmpty
        icon={CloudSlash}
        tone="neutral"
        title={ERROR_TITLE}
        description={ERROR_DESCRIPTION}
        actionLabel="Повторить"
        onAction={onRetry}
      />
    </div>
  );
}

/** Карточка-список: строки на одной плоскости с разделителями, без теней. */
export function ListCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="list-card stagger" role="list" aria-label={label}>
      {children}
    </div>
  );
}

type ListGroupProps = {
  id: string;
  title: string;
  children: ReactNode;
  /** Без подложки карточки: содержимое само решает, как лежать на фоне. */
  plain?: boolean;
};

/** Группа с подписью капсом: подпись и карточка под ней. */
export function ListGroup({ id, title, children, plain = false }: ListGroupProps) {
  return (
    <section className="list-group" aria-labelledby={id}>
      <h2 className="caps-label list-group__title" id={id}>
        {title}
      </h2>
      {plain ? children : <div className="list-card">{children}</div>}
    </section>
  );
}

/** Скелетон строки списка на время загрузки. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="list-card" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: count }, (_, index) => (
        <div className="list-row list-row--skeleton" key={index} aria-hidden>
          <span className="skeleton skeleton--tile" />
          <span className="list-row__copy">
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line skeleton--short" />
          </span>
        </div>
      ))}
    </div>
  );
}

type RowShellProps = {
  children: ReactNode;
  onOpen?: () => void;
  className?: string;
  /** Что стоит справа у открываемой строки; по умолчанию шеврон. */
  trailing?: ReactNode;
};

/** Строка списка: кнопка, если её можно открыть, иначе просто элемент списка. */
export function RowShell({ children, onOpen, className = '', trailing }: RowShellProps) {
  if (!onOpen) {
    return (
      <div className={`list-row ${className}`} role="listitem">
        {children}
      </div>
    );
  }

  return (
    <div role="listitem">
      <button className={`list-row list-row--interactive ${className}`} type="button" onClick={onOpen}>
        {children}
        {trailing ?? <CaretRight className="icon icon--small icon--mute" aria-hidden />}
      </button>
    </div>
  );
}

export function RequestRow({ request, onOpen }: { request: RequestSummary; onOpen?: () => void }) {
  const tone = requestStatusTones[request.status];
  const category = categoryVisual(request.category);

  return (
    <RowShell onOpen={onOpen} className="list-row--request">
      <IconTile icon={category.icon} size="small" tone={category.tone} />
      <span className="list-row__copy">
        <Typography.Text asChild variant="description" color="tertiary">
          <span>
            <span className="tabular nowrap">№ {request.number}</span> · {request.category}
          </span>
        </Typography.Text>
        <Typography.Text asChild variant="body-strong">
          <span className="list-row__title">{request.title}</span>
        </Typography.Text>
        <span className="list-row__meta">
          <span className={`status-badge status-badge--${tone}`}>{requestStatusLabels[request.status]}</span>
          {request.status === 'done' ? (
            // Выполненная Заявка ждёт ответа Жильца — подсказываем, что от него нужно.
            <span className="list-row__hint">Подтвердите исправление</span>
          ) : (
            <Typography.Text asChild variant="description" color="tertiary">
              <time dateTime={request.updatedAt}>{formatUpdatedAt(request.updatedAt)}</time>
            </Typography.Text>
          )}
        </span>
      </span>
    </RowShell>
  );
}

export const eventIcons: Record<HouseEventKind, IconComponent> = {
  accident: Warning,
  'planned-outage': CalendarBlank,
  announcement: Megaphone,
};

export const eventTones: Record<HouseEventKind, TileTone> = {
  accident: 'danger',
  'planned-outage': 'coral',
  announcement: 'pink',
};

export function EventRow({ event, onOpen }: { event: HouseEventSummary; onOpen?: () => void }) {
  return (
    <RowShell onOpen={onOpen}>
      <IconTile icon={eventIcons[event.kind]} size="small" tone={eventTones[event.kind]} />
      <span className="list-row__copy">
        <Typography.Text asChild variant="body-strong">
          <span className="list-row__title">{event.title}</span>
        </Typography.Text>
        <Typography.Text asChild variant="description" color="secondary">
          <span>
            {houseEventKindLabels[event.kind]} · <span className="tabular nowrap">{event.period}</span>
          </span>
        </Typography.Text>
      </span>
    </RowShell>
  );
}

type BottomNavigationProps = {
  active: AppRoute;
  navigate: Navigate;
};

const tabs: Array<{ label: string; icon: IconComponent; route: AppRoute }> = [
  { label: 'Главная', icon: House, route: ROUTES.home },
  { label: 'Заявки', icon: FileText, route: ROUTES.requests },
  { label: 'Сервисы', icon: SquaresFour, route: ROUTES.services },
  { label: 'Профиль', icon: User, route: ROUTES.profile },
];

export function BottomNavigation({ active, navigate }: BottomNavigationProps) {
  // Счётчик на «Заявках»: Выполненные Заявки ждут, что Жилец подтвердит исправление.
  const { requests } = useHomeData();
  const awaitingConfirmation = requests.filter((request) => request.status === 'done').length;

  return (
    <nav className="bottom-navigation" aria-label="Основная навигация">
      {tabs.map(({ label, icon: Icon, route }) => {
        const isActive = route === active;
        const counter = route === ROUTES.requests ? awaitingConfirmation : 0;
        return (
          <button
            className={`bottom-navigation__item pressable${isActive ? ' bottom-navigation__item--active' : ''}`}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (!isActive) navigate(route);
            }}
            key={label}
          >
            <span className="bottom-navigation__icon">
              <Icon className="icon" weight={isActive ? 'fill' : 'regular'} aria-hidden />
              {counter > 0 ? (
                <Counter
                  className="bottom-navigation__counter"
                  value={counter}
                  variant="primary"
                  rounded
                  aria-label={`Ждут подтверждения: ${counter}`}
                />
              ) : null}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
