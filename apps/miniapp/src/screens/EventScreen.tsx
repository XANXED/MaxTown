import { CalendarX, Phone, UsersThree } from '@phosphor-icons/react';
import { Button, Typography } from '@maxhub/max-ui';
import type { HouseEventDetails } from '@maxtown/shared';
import { systemVisuals } from '../components/categoryVisuals.ts';
import {
  EmptyState,
  ErrorState,
  eventIcons,
  eventTones,
  IconTile,
  ListGroup,
  MiniTile,
  SkeletonRows,
} from '../components/ui.tsx';
import type { HouseSystemName } from '../data/categories.ts';
import { eventPhase, eventPhaseLabel, formatEventTime, useEventDetails, type EventPhase } from '../data/eventDetails.ts';
import { houseEventKindLabels, type StatusTone } from '../data/labels.ts';
import { plural } from '../data/text.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

/** Не работает сейчас — сигнальный; впереди — нейтральный; позади — зелёный. */
const phaseTones: Record<EventPhase, StatusTone> = {
  upcoming: 'neutral',
  ongoing: 'negative',
  finished: 'positive',
};

const aboutTitles: Record<HouseEventDetails['kind'], string> = {
  accident: 'Что случилось',
  'planned-outage': 'Подробности',
  announcement: 'Объявление',
};

/** Карточка События дома: когда, что затронуто и что делать Жильцу. */
export function EventScreen({ id, navigate }: { id: string; navigate: Navigate }) {
  const { status, data: event, retry } = useEventDetails(id);

  if (status === 'loading') {
    return (
      <main className="screen screen--inner inner-content" id="main-content" aria-busy="true">
        <div className="card-head card-head--skeleton" aria-hidden>
          <span className="skeleton skeleton--tile-medium" />
          <span className="skeleton skeleton--line skeleton--short" />
          <span className="skeleton skeleton--title" />
        </div>
        <SkeletonRows count={3} />
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ErrorState onRetry={retry} />
      </main>
    );
  }

  if (!event) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <div className="list-card">
          <EmptyState
            icon={CalendarX}
            title="Событие не найдено"
            description="Возможно, его уже убрали. Актуальные События дома собраны в списке"
            action={
              <Button size="small" variant="secondary" onClick={() => navigate(ROUTES.events)}>
                К Событиям дома
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  const phase = eventPhase(event, new Date());
  const openAccident = event.kind === 'accident' && phase !== 'finished';

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <EventHead event={event} phase={phase} />

        {openAccident && event.linkedRequests ? (
          <aside className="outcome">
            <UsersThree className="icon" weight="fill" aria-hidden />
            <span className="outcome__copy">
              <Typography.Text asChild variant="body-strong">
                <p>
                  Об Аварии уже сообщили:{' '}
                  <span className="tabular">
                    {event.linkedRequests} {plural(event.linkedRequests, ['Заявка', 'Заявки', 'Заявок'])}
                  </span>
                </p>
              </Typography.Text>
              <Typography.Text asChild variant="description" color="secondary">
                <p>Отдельно подавать не нужно. Ваши Заявки об этом закроются вместе с Аварией.</p>
              </Typography.Text>
            </span>
          </aside>
        ) : null}

        <ListGroup id="event-when" title="Когда и где">
          <dl className="facts">
            <div className="facts__row">
              <dt>{event.kind === 'accident' ? 'Началась' : event.endsAt ? 'Начало' : 'Когда'}</dt>
              <dd className="tabular">{formatEventTime(event.startsAt)}</dd>
            </div>
            {event.resolvedAt ? (
              <div className="facts__row">
                <dt>Закрыта</dt>
                <dd className="tabular">{formatEventTime(event.resolvedAt)}</dd>
              </div>
            ) : event.endsAt ? (
              <div className="facts__row">
                <dt>{event.kind === 'accident' ? 'Устранят к' : 'Окончание'}</dt>
                <dd className="tabular">{formatEventTime(event.endsAt)}</dd>
              </div>
            ) : event.kind === 'accident' ? (
              <div className="facts__row">
                <dt>Устранят к</dt>
                <dd>
                  Уточняется
                  <span className="facts__hint">Обновим, когда Ответственный сообщит срок</span>
                </dd>
              </div>
            ) : null}
            {event.scope ? (
              <div className="facts__row">
                <dt>Где</dt>
                <dd>{event.scope}</dd>
              </div>
            ) : null}
          </dl>
        </ListGroup>

        {event.systems.length > 0 ? (
          <ListGroup id="event-systems" title="Затронуты">
            <ul className="system-chips system-chips--wrap" aria-label="Затронутые Системы">
              {event.systems.map((name) => {
                const visual = systemVisuals[name as HouseSystemName];
                return (
                  <li className="system-chip" key={name}>
                    {visual ? <MiniTile icon={visual.icon} tone={visual.tone} /> : null}
                    {name}
                  </li>
                );
              })}
            </ul>
          </ListGroup>
        ) : null}

        <ListGroup id="event-about" title={aboutTitles[event.kind]}>
          <div className="request-description">
            <Typography.Text asChild variant="body">
              <p>{event.description}</p>
            </Typography.Text>
            {event.author ? (
              <Typography.Text asChild variant="description" color="tertiary">
                <p>
                  {event.author.role} {event.author.name}
                </p>
              </Typography.Text>
            ) : null}
          </div>
        </ListGroup>

        {event.advice.length > 0 ? (
          <ListGroup id="event-advice" title="Что делать">
            <ul className="advice">
              {event.advice.map((line) => (
                <li className="advice__item" key={line}>
                  {line}
                </li>
              ))}
            </ul>
          </ListGroup>
        ) : null}

        {openAccident ? (
          <Button
            size="medium"
            variant="secondary"
            stretched
            iconBefore={<Phone className="icon icon--small" weight="fill" aria-hidden />}
            onClick={() => navigate(ROUTES.contacts)}
          >
            Аварийная служба
          </Button>
        ) : null}
      </div>
    </main>
  );
}

function EventHead({ event, phase }: { event: HouseEventDetails; phase: EventPhase }) {
  const label = eventPhaseLabel(event.kind, phase);
  return (
    <header className="card-head">
      <IconTile icon={eventIcons[event.kind]} tone={eventTones[event.kind]} size="medium" />
      <Typography.Text asChild variant="description" color="tertiary">
        <span>{houseEventKindLabels[event.kind]}</span>
      </Typography.Text>
      <Typography.Text asChild variant="header">
        <h1>{event.title}</h1>
      </Typography.Text>
      <span className="list-row__meta">
        {label ? <span className={`status-badge status-badge--${phaseTones[phase]}`}>{label}</span> : null}
        <Typography.Text asChild variant="description" color="tertiary">
          <span className="tabular">{event.period}</span>
        </Typography.Text>
      </span>
    </header>
  );
}
