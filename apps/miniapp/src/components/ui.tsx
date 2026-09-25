import type { ComponentType, ReactNode } from 'react';
import {
  CaretRight,
  FileText,
  House,
  Megaphone,
  SquaresFour,
  User,
  Warning,
  Wrench,
  CalendarBlank,
} from '@phosphor-icons/react';
import { Counter, Typography } from '@maxhub/max-ui';
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

/** Карточка-список: строки на одной плоскости с разделителями, без теней. */
export function ListCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="list-card stagger" role="list" aria-label={label}>
      {children}
    </div>
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

  return (
    <RowShell onOpen={onOpen} className="list-row--request">
      <IconTile icon={Wrench} size="small" tone="coral" />
      <span className="list-row__copy">
        <Typography.Text asChild variant="description" color="tertiary">
          <span>
            № {request.number} · {request.category}
          </span>
        </Typography.Text>
        <Typography.Text asChild variant="body-strong">
          <span className="list-row__title">{request.title}</span>
        </Typography.Text>
        <span className="list-row__meta">
          <span className={`status-badge status-badge--${tone}`}>{requestStatusLabels[request.status]}</span>
          <Typography.Text asChild variant="description" color="tertiary">
            <time dateTime={request.updatedAt}>{formatUpdatedAt(request.updatedAt)}</time>
          </Typography.Text>
        </span>
      </span>
    </RowShell>
  );
}

const eventIcons: Record<HouseEventKind, IconComponent> = {
  accident: Warning,
  'planned-outage': CalendarBlank,
  announcement: Megaphone,
};

const eventTones: Record<HouseEventKind, TileTone> = {
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
            {houseEventKindLabels[event.kind]} · {event.period}
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
