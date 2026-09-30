import { useRef, useState, type FormEvent } from 'react';
import { CalendarX, Phone } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/platform-ui.tsx';
import type { AccidentUpdate, AccidentWorkStatus, HouseEventDetails } from '@maxtown/shared';
import { systemVisuals } from '../components/categoryVisuals.ts';
import { EmergencyPanel } from '../components/EmergencyPanel.tsx';
import {
  EmptyState,
  ErrorState,
  eventIcons,
  eventTones,
  IconTile,
  ListGroup,
  MiniTile,
  Segmented,
  SkeletonRows,
} from '../components/ui.tsx';
import { ApiError } from '../data/api.ts';
import type { HouseSystemName } from '../data/categories.ts';
import { eventPeriod, eventPhase, eventPhaseLabel, eventsClient, formatEventTime, useEventDetails, type EventPhase } from '../data/eventDetails.ts';
import { eventEmergency, type EmergencyView } from '../data/houseState.ts';
import { houseEventKindLabels, type StatusTone } from '../data/labels.ts';
import { fromDateTimeLocal, toDateTimeLocal } from '../data/repairMode.ts';
import { ROUTES } from '../routes.ts';
import { canManageServices, useMembership } from '../auth/membership.tsx';
import type { Navigate, Notify } from './types.ts';

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
export function EventScreen({ id, navigate, notify }: { id: string; navigate: Navigate; notify?: Notify }) {
  const { status, data: event, retry, replace } = useEventDetails(id);
  const membership = useMembership();
  const [confirming, setConfirming] = useState(false);

  // «У меня тоже» на Аварии: ответ сервера заменяет карточку.
  const confirm = async (eventId: string, confirmed: boolean) => {
    if (!membership) {
      notify?.('В примере отметка не сохраняется: войдите через MAX');
      return;
    }
    setConfirming(true);
    try {
      replace(await eventsClient.confirm(membership.houseId, eventId, confirmed));
      notify?.(confirmed ? 'Отметили: у вас тоже. Уведомим, когда Аварию устранят' : 'Отметка снята');
    } catch (error) {
      notify?.(error instanceof Error ? error.message : 'Не удалось сохранить отметку');
      if (error instanceof ApiError && error.code === 'accident_already_resolved') retry();
    } finally {
      setConfirming(false);
    }
  };

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
  // Режим ЧС: сколько квартир подтвердили, статус работ и срок — вместо «N человек пожаловались».
  const emergency = eventEmergency(event);
  const manager = membership && canManageServices(membership.role) ? membership : null;

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <EventHead event={event} phase={phase} />

        {emergency ? (
          <EmergencyPanel
            emergency={emergency}
            headless
            busy={confirming}
            onConfirm={(confirmed) => void confirm(event.id, confirmed)}
          />
        ) : null}

        {emergency && manager ? (
          <AccidentControls
            event={event}
            emergency={emergency}
            onSave={async (update) => {
              replace(await eventsClient.update(manager.houseId, event.id, update));
              notify?.(update.workStatus === 'repairing' || update.expectedResolutionAt !== undefined
                ? 'Сохранено. Кто сообщил о проблеме, получит уведомление'
                : 'Сохранено');
            }}
          />
        ) : null}

        {event.openedAutomatically && openAccident ? (
          <Typography.Text asChild variant="description" color="secondary">
            <p>
              Открыта автоматически: о неполадке сообщили несколько Жильцов. УК и Администратор Дома уже видят Заявки.
            </p>
          </Typography.Text>
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
            ) : emergency ? null : event.endsAt ? (
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

        {openAccident && manager ? (
          <ResolveAccident
            onResolve={async () => {
              const resolved = await eventsClient.resolve(manager.houseId, event.id);
              replace(resolved);
              notify?.('Авария закрыта. Привязанные Заявки закрыты вместе с ней');
            }}
          />
        ) : null}

        {event.kind !== 'accident' && manager ? (
          <RemovePublication
            onRemove={async () => {
              await eventsClient.removePublication(manager.houseId, event.id);
              notify?.('Событие убрано из Дома');
              navigate(ROUTES.events);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

function RemovePublication({ onRemove }: { onRemove: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) return <button className="danger-action pressable" type="button" onClick={() => setAsking(true)}>Убрать Событие</button>;
  return (
    <section className="decision-card reveal" aria-labelledby="remove-event-title">
      <Typography.Text asChild variant="title"><h2 id="remove-event-title">Убрать Событие?</h2></Typography.Text>
      <Typography.Text asChild variant="description" color="secondary"><p>Жильцы больше не увидят его в списке и Состоянии дома.</p></Typography.Text>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="decision-card__actions">
        <Button variant="destructive" loading={saving} onClick={() => {
          setSaving(true);
          setError(null);
          onRemove().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : 'Не удалось убрать Событие');
            setSaving(false);
          });
        }}>Убрать</Button>
        <Button variant="secondary" onClick={() => setAsking(false)}>Отмена</Button>
      </div>
    </section>
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
          <span className="tabular">{eventPeriod(event)}</span>
        </Typography.Text>
      </span>
    </header>
  );
}

const workStatusOptions: Array<{ value: AccidentWorkStatus; label: string }> = [
  { value: 'checking', label: 'Выясняют причину' },
  { value: 'repairing', label: 'Аварийные работы' },
];

type AccidentControlsProps = {
  event: HouseEventDetails;
  emergency: EmergencyView;
  onSave: (update: AccidentUpdate) => Promise<void>;
};

/**
 * УК и Администратор Дома ведут Аварию: что случилось, статус работ и срок.
 * Жильцы, которые сообщили о проблеме, узнают о начале работ и новом сроке.
 */
function AccidentControls({ event, emergency, onSave }: AccidentControlsProps) {
  const [title, setTitle] = useState(event.title);
  const [workStatus, setWorkStatus] = useState<AccidentWorkStatus>(emergency.workStatus);
  const [until, setUntil] = useState(() => toDateTimeLocal(event.endsAt ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Ответ сервера после сохранения — новая основа формы. Форма остаётся той
  // же (фокус не теряется), поля берут сохранённые значения.
  const saved = `${event.title}|${emergency.workStatus}|${event.endsAt ?? ''}`;
  const [base, setBase] = useState(saved);
  if (base !== saved) {
    setBase(saved);
    setTitle(event.title);
    setWorkStatus(emergency.workStatus);
    setUntil(toDateTimeLocal(event.endsAt ?? null));
  }

  // Отправляем только изменённое: сервер уведомляет о статусе и сроке по факту изменения.
  const update: AccidentUpdate = {};
  if (title.trim() && title.trim() !== event.title) update.title = title.trim();
  if (workStatus !== emergency.workStatus) update.workStatus = workStatus;
  if (until !== toDateTimeLocal(event.endsAt ?? null)) update.expectedResolutionAt = fromDateTimeLocal(until);
  const changed = Object.keys(update).length > 0;

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (saving || !changed) return;
    if (!title.trim()) {
      setError('Напишите, что случилось');
      return;
    }
    if (update.expectedResolutionAt && new Date(update.expectedResolutionAt).getTime() <= Date.now()) {
      setError('Срок уже прошёл. Укажите время в будущем или оставьте поле пустым');
      return;
    }
    setSaving(true);
    setError(null);
    onSave(update)
      // Сохранённая форма гасит кнопку «Сохранить», и фокус с неё слетел бы в никуда.
      .then(() => headingRef.current?.focus({ preventScroll: true }))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить Аварию'))
      .finally(() => setSaving(false));
  };

  return (
    <form className="decision-card accident-controls" aria-labelledby="accident-controls-title" onSubmit={submit} noValidate>
      <Typography.Text asChild variant="title">
        <h2 id="accident-controls-title" ref={headingRef} tabIndex={-1}>Ход работ</h2>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p>Жильцы видят это в Состоянии дома. Кто сообщил о проблеме, получит уведомление о начале работ и новом сроке.</p>
      </Typography.Text>

      <label className="accident-controls__label" htmlFor="accident-edit-title">
        <Typography.Text asChild variant="body-strong"><span>Что случилось</span></Typography.Text>
      </label>
      <Input
        id="accident-edit-title"
        value={title}
        maxLength={120}
        placeholder="Например: нет холодной воды"
        onChange={(changeEvent) => setTitle(changeEvent.target.value)}
      />

      <span className="accident-controls__label">
        <Typography.Text asChild variant="body-strong"><span>Статус</span></Typography.Text>
      </span>
      <Segmented label="Статус работ" options={workStatusOptions} value={workStatus} onChange={setWorkStatus} />

      <label className="accident-controls__label" htmlFor="accident-edit-until">
        <Typography.Text asChild variant="body-strong"><span>{event.endsAt ? 'Срок устранения' : 'Устранят к'}</span></Typography.Text>
      </label>
      <input
        id="accident-edit-until"
        className="date-field"
        type="datetime-local"
        value={until}
        aria-describedby="accident-edit-until-hint"
        onChange={(changeEvent) => setUntil(changeEvent.target.value)}
      />
      <Typography.Text asChild variant="description" color="tertiary">
        <p id="accident-edit-until-hint">
          {event.endsAt
            ? 'Перенесёте срок — Жильцы увидят «Новый срок». Пустое поле — «Срок уточняется».'
            : 'Пока срок неизвестен, Жильцы видят «Срок уточняется».'}
        </p>
      </Typography.Text>

      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="decision-card__actions">
        <Button type="submit" size="medium" variant="primary" stretched loading={saving} disabled={!changed}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

/** Закрытие Аварии в два шага: оно закрывает и все привязанные Заявки. */
function ResolveAccident({ onResolve }: { onResolve: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button className="danger-action pressable" type="button" onClick={() => setAsking(true)}>
        Закрыть Аварию
      </button>
    );
  }

  return (
    <section className="decision-card reveal" aria-labelledby="resolve-title">
      <Typography.Text asChild variant="title">
        <h2 id="resolve-title">Неполадку устранили?</h2>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p>Авария закроется, а с ней все привязанные Заявки. Жильцы получат уведомление.</p>
      </Typography.Text>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="decision-card__actions">
        <Button
          size="medium"
          variant="primary"
          stretched
          loading={saving}
          onClick={() => {
            setSaving(true);
            setError(null);
            onResolve()
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось закрыть Аварию'))
              .finally(() => setSaving(false));
          }}
        >
          Закрыть Аварию
        </Button>
        <Button size="medium" variant="ghost" stretched disabled={saving} onClick={() => setAsking(false)}>
          Не закрывать
        </Button>
      </div>
    </section>
  );
}
