import { useState, type FormEvent } from 'react';
import { CheckCircle, FileX, PaperPlaneRight, Prohibit, UsersThree, XCircle } from '@phosphor-icons/react';
import { Button, Textarea, Typography } from '../components/platform-ui.tsx';
import type { RequestAction, RequestDetails } from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { categoryVisual } from '../components/categoryVisuals.ts';
import { EmptyState, ErrorState, IconTile, ListGroup, SkeletonRows } from '../components/ui.tsx';
import { findSubcategory, requestPlaces } from '../data/categories.ts';
import { RequestIllustration } from '../components/requestIllustrations.tsx';
import { formatUpdatedAt, requestStatusLabels, requestStatusTones } from '../data/labels.ts';
import { formatVisit, requestTimeline } from '../data/requestDetails.ts';
import { useRequestPhotoUrls } from '../data/requestPhotos.ts';
import { requestsClient, useRequestDetails } from '../data/requests.ts';
import { fromDateTimeLocal, toDateTimeLocal } from '../data/repairMode.ts';
import { plural } from '../data/text.ts';
import { eventRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const COMMENT_LIMIT = 1000;

type RequestScreenProps = {
  id: string;
  navigate: Navigate;
  notify: Notify;
};

/** Изменить Заявку на сервере; true — сервер принял, карточка уже обновлена. */
type Perform = (call: (houseId: string) => Promise<RequestDetails>, message?: string) => Promise<boolean>;

/** Карточка Заявки: что с ней сейчас, как она шла, подробности и Комментарии. */
export function RequestScreen({ id, navigate, notify }: RequestScreenProps) {
  const { status, data: request, retry, replace } = useRequestDetails(id);
  const houseId = useMembership()?.houseId ?? null;
  const [busy, setBusy] = useState(false);

  // Что можно сделать, решает сервер (request.actions); ответ заменяет карточку.
  const perform: Perform = async (call, message) => {
    if (!houseId) {
      notify('В примере Заявка не меняется: войдите через MAX');
      return false;
    }
    setBusy(true);
    try {
      replace(await call(houseId));
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось изменить Заявку');
      return false;
    } finally {
      setBusy(false);
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

  if (!request) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <div className="list-card">
          <EmptyState
            icon={FileX}
            title="Заявка не найдена"
            description="Возможно, ссылка устарела. Все ваши Заявки собраны в списке"
            action={
              <Button size="small" variant="secondary" onClick={() => navigate(ROUTES.requests)}>
                К списку Заявок
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  const act = (action: RequestAction, message: string, extra: { note?: string; scheduledAt?: string } = {}) =>
    perform((house) => requestsClient.act(house, request.id, action, extra), message);
  const can = (action: RequestAction) => request.actions.includes(action);

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <RequestHead request={request} />

        {can('confirm') ? (
          <FixDecision
            busy={busy}
            onConfirm={() => void act('confirm', 'Заявка закрыта. Спасибо, что проверили')}
            onNotFixed={(details) => void act('not-fixed', 'Заявка вернулась в работу. Ответственный увидит ваш ответ', details.trim() ? { note: details.trim() } : {})}
          />
        ) : (
          <Outcome request={request} />
        )}

        <ProcessorActions request={request} busy={busy} act={act} />

        {request.canSupport || request.supportedByMe ? (
          <SupportCard
            request={request}
            busy={busy}
            onToggle={(supported) => void perform(
              (house) => requestsClient.support(house, request.id, supported),
              supported ? 'Отметили: у вас тоже. Вы получите уведомление, когда проблему решат' : 'Отметка снята',
            )}
          />
        ) : null}

        <ListGroup id="request-timeline" title="Ход заявки">
          <ol className="timeline">
            {requestTimeline(request).map((step) => (
              <li className={`timeline__step timeline__step--${step.state} timeline__step--${step.status}`} key={step.key}>
                <span className="timeline__marker" aria-hidden />
                <span className="timeline__copy">
                  <Typography.Text asChild variant={step.state === 'current' ? 'body-strong' : 'body'}>
                    <span className="timeline__label">
                      {step.label}
                      {step.state === 'current' ? <span className="visually-hidden">, сейчас</span> : null}
                    </span>
                  </Typography.Text>
                  {/* Причину отказа уже показывает итог наверху. */}
                  {step.note && step.status !== 'rejected' ? (
                    <Typography.Text asChild variant="description" color="secondary">
                      <span>{step.note}</span>
                    </Typography.Text>
                  ) : null}
                  {step.at ? (
                    <Typography.Text asChild variant="description" color="tertiary">
                      <time dateTime={step.at}>{formatUpdatedAt(step.at)}</time>
                    </Typography.Text>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </ListGroup>

        <RequestFacts request={request} onOpenAccident={(accidentId) => navigate(eventRoute(accidentId))} />

        <RequestDescription request={request} />

        <Comments
          request={request}
          onSend={(text) => perform((house) => requestsClient.comment(house, request.id, text))}
        />

        {can('cancel') ? (
          <CancelRequest
            number={request.number}
            busy={busy}
            onCancel={() => void act('cancel', `Заявка № ${request.number} отменена`)}
          />
        ) : null}
      </div>
    </main>
  );
}

function RequestHead({ request }: { request: RequestDetails }) {
  const category = categoryVisual(request.category);
  return (
    <header className="card-head">
      <IconTile icon={category.icon} tone={category.tone} size="medium" />
      <Typography.Text asChild variant="description" color="tertiary">
        <span>
          <span className="tabular nowrap">Заявка № {request.number}</span> · {request.category}
        </span>
      </Typography.Text>
      <Typography.Text asChild variant="header">
        <h1>{request.title}</h1>
      </Typography.Text>
      <span className="list-row__meta">
        <span className={`status-badge status-badge--${requestStatusTones[request.status]}`}>
          {requestStatusLabels[request.status]}
        </span>
        <Typography.Text asChild variant="description" color="tertiary">
          <span>
            Обновлена <time dateTime={request.updatedAt}>{formatUpdatedAt(request.updatedAt).toLocaleLowerCase('ru-RU')}</time>
          </span>
        </Typography.Text>
      </span>
    </header>
  );
}

type FixDecisionProps = {
  busy: boolean;
  onConfirm: () => void;
  onNotFixed: (details: string) => void;
};

/** Выполненная Заявка ждёт ответа автора: подтвердить или вернуть в работу. */
function FixDecision({ busy, onConfirm, onNotFixed }: FixDecisionProps) {
  const [explaining, setExplaining] = useState(false);
  const [details, setDetails] = useState('');

  return (
    <section className="decision-card" aria-labelledby="decision-title">
      <Typography.Text asChild variant="title">
        <h2 id="decision-title">Ответственный сообщил, что всё исправлено</h2>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p>Проверьте и ответьте. Если не ответите, Заявка закроется после напоминания.</p>
      </Typography.Text>

      {explaining ? (
        <form
          className="decision-card__form reveal"
          onSubmit={(event) => {
            event.preventDefault();
            onNotFixed(details);
          }}
        >
          <label className="visually-hidden" htmlFor="not-fixed-details">
            Что осталось не так
          </label>
          <Textarea
            id="not-fixed-details"
            className="request-textarea"
            value={details}
            rows={3}
            maxLength={COMMENT_LIMIT}
            placeholder="Что осталось не так? Необязательно, но так Ответственный поймёт быстрее"
            onChange={(event) => setDetails(event.target.value)}
            autoFocus
          />
          <div className="decision-card__actions">
            <Button type="submit" size="medium" variant="primary" stretched loading={busy}>
              Вернуть в работу
            </Button>
            <Button type="button" size="medium" variant="ghost" stretched disabled={busy} onClick={() => setExplaining(false)}>
              Назад к ответу
            </Button>
          </div>
        </form>
      ) : (
        <div className="decision-card__actions">
          <Button size="medium" variant="primary" stretched loading={busy} onClick={onConfirm}>
            Подтвердить исправление
          </Button>
          <Button size="medium" variant="secondary" stretched disabled={busy} onClick={() => setExplaining(true)}>
            Не исправлено
          </Button>
        </div>
      )}
    </section>
  );
}

/** Итог Заявки, которая уже не ждёт автора: закрыта, отклонена или отменена. */
function Outcome({ request }: { request: RequestDetails }) {
  const last = request.history.at(-1);
  switch (request.status) {
    case 'closed':
      return (
        <aside className="outcome outcome--positive">
          <CheckCircle className="icon" weight="fill" aria-hidden />
          <Typography.Text asChild variant="body">
            <p>{last?.note ? `Заявка закрыта: ${last.note.toLocaleLowerCase('ru-RU')}.` : 'Исправление подтверждено, Заявка закрыта.'}</p>
          </Typography.Text>
        </aside>
      );
    case 'rejected':
      return (
        <aside className="outcome outcome--negative">
          <XCircle className="icon" weight="fill" aria-hidden />
          <span className="outcome__copy">
            <Typography.Text asChild variant="body-strong">
              <p>Ответственный отклонил Заявку</p>
            </Typography.Text>
            {last?.note ? (
              <Typography.Text asChild variant="description" color="secondary">
                <p>Причина: {last.note}</p>
              </Typography.Text>
            ) : null}
          </span>
        </aside>
      );
    case 'cancelled':
      return (
        <aside className="outcome">
          <Prohibit className="icon" aria-hidden />
          <Typography.Text asChild variant="body">
            <p>{request.relation === 'author' ? 'Вы отменили эту Заявку.' : 'Автор отменил эту Заявку.'}</p>
          </Typography.Text>
        </aside>
      );
    default:
      return null;
  }
}

type ActFn = (action: RequestAction, message: string, extra?: { note?: string; scheduledAt?: string }) => Promise<boolean>;

/** Действия УК и Администратора: взять в работу, назначить Визит, отметить выполненной, отклонить. */
function ProcessorActions({ request, busy, act }: { request: RequestDetails; busy: boolean; act: ActFn }) {
  const can = (action: RequestAction) => request.actions.includes(action);
  const [visitAt, setVisitAt] = useState(() => toDateTimeLocal(request.visit?.scheduledAt ?? null));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  if (!can('take') && !can('complete') && !can('schedule-visit') && !can('reject')) return null;

  const scheduled = fromDateTimeLocal(visitAt);
  return (
    <section className="decision-card" aria-labelledby="processor-title">
      <Typography.Text asChild variant="title">
        <h2 id="processor-title">{request.status === 'new' ? 'Новая Заявка' : 'Заявка в работе'}</h2>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p>
          {request.status === 'new'
            ? 'Возьмите её в работу: Жилец увидит, что Ответственный назначен.'
            : 'Когда неисправность устранят, отметьте Заявку выполненной — Жилец подтвердит исправление.'}
        </p>
      </Typography.Text>

      {can('schedule-visit') ? (
        <form
          className="decision-card__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (scheduled) void act('schedule-visit', 'Время Визита назначено. Жилец получит уведомление', { scheduledAt: scheduled });
          }}
        >
          <label htmlFor="visit-at">
            <Typography.Text asChild variant="body-strong">
              <span>{request.visit?.scheduledAt ? 'Перенести Визит' : 'Время Визита'}</span>
            </Typography.Text>
          </label>
          <input
            id="visit-at"
            className="date-field"
            type="datetime-local"
            value={visitAt}
            onChange={(event) => setVisitAt(event.target.value)}
          />
          <Button type="submit" size="medium" variant="secondary" stretched disabled={!scheduled || busy}>
            {request.visit?.scheduledAt ? 'Перенести Визит' : 'Назначить Визит'}
          </Button>
        </form>
      ) : null}

      {rejecting ? (
        <form
          className="decision-card__form reveal"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) void act('reject', `Заявка № ${request.number} отклонена`, { note: reason.trim() });
          }}
        >
          <label className="visually-hidden" htmlFor="reject-reason">
            Причина отказа
          </label>
          <Textarea
            id="reject-reason"
            className="request-textarea"
            value={reason}
            rows={3}
            maxLength={COMMENT_LIMIT}
            placeholder="Почему Заявку не выполнить? Жилец увидит причину"
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
          <div className="decision-card__actions">
            <Button type="submit" size="medium" variant="destructive" stretched loading={busy} disabled={!reason.trim()}>
              Отклонить
            </Button>
            <Button type="button" size="medium" variant="ghost" stretched disabled={busy} onClick={() => setRejecting(false)}>
              Не отклонять
            </Button>
          </div>
        </form>
      ) : (
        <div className="decision-card__actions">
          {can('take') ? (
            <Button size="medium" variant="primary" stretched loading={busy} onClick={() => void act('take', 'Заявка взята в работу. Жилец получит уведомление')}>
              Взять в работу
            </Button>
          ) : null}
          {can('complete') ? (
            <Button size="medium" variant="primary" stretched loading={busy} onClick={() => void act('complete', 'Заявка выполнена. Ждём подтверждения Жильца')}>
              Выполнено
            </Button>
          ) : null}
          {can('reject') ? (
            <Button size="medium" variant="ghost" stretched disabled={busy} onClick={() => setRejecting(true)}>
              Отклонить
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** «У меня тоже»: сосед подтверждает проблему в Общем имуществе вместо того, чтобы подавать дубль. */
function SupportCard({ request, busy, onToggle }: { request: RequestDetails; busy: boolean; onToggle: (supported: boolean) => void }) {
  const others = request.supportCount - (request.supportedByMe ? 1 : 0);
  return (
    <section className="decision-card" aria-labelledby="support-title">
      <span className="support-card__head">
        <UsersThree className="icon" weight="fill" aria-hidden />
        <Typography.Text asChild variant="title">
          <h2 id="support-title">{request.supportedByMe ? 'Вы отметили: у вас тоже' : 'Столкнулись с этим тоже?'}</h2>
        </Typography.Text>
      </span>
      <Typography.Text asChild variant="description" color="secondary">
        <p>
          {others > 0
            ? `Ещё ${others} ${plural(others, ['Жилец отметил', 'Жильца отметили', 'Жильцов отметили'])} «У меня тоже». `
            : ''}
          {request.supportedByMe
            ? 'Вы получите уведомление, когда проблему решат.'
            : 'Отметьте, и подавать такую же Заявку не нужно. Когда сообщат трое, откроется Авария.'}
        </p>
      </Typography.Text>
      <div className="decision-card__actions">
        {request.supportedByMe ? (
          <Button size="medium" variant="ghost" stretched loading={busy} onClick={() => onToggle(false)}>
            Убрать отметку
          </Button>
        ) : (
          <Button size="medium" variant="primary" stretched loading={busy} onClick={() => onToggle(true)}>
            У меня тоже
          </Button>
        )}
      </div>
    </section>
  );
}

function RequestFacts({ request, onOpenAccident }: { request: RequestDetails; onOpenAccident: (id: string) => void }) {
  const place = requestPlaces.find(({ value }) => value === request.place)?.label ?? '';
  const visit = request.visit ? formatVisit(request.visit) : null;
  const subcategory = findSubcategory(request.category, request.subcategory);
  const { accidentId } = request;

  return (
    <ListGroup id="request-facts" title="Подробности">
      <dl className="facts">
        {subcategory ? (
          <div className="facts__row">
            <dt>Что сломалось</dt>
            <dd>
              {subcategory.label}
              {subcategory.id !== 'other' ? (
                <span className="facts__illustration">
                  <RequestIllustration category={request.category} subcategory={subcategory.id} />
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div className="facts__row">
          <dt>Где</dt>
          <dd>{request.apartment ? `${place}, № ${request.apartment}` : place}</dd>
        </div>
        {request.authorName ? (
          <div className="facts__row">
            <dt>Жилец</dt>
            <dd>{request.authorName}</dd>
          </div>
        ) : null}
        {visit ? (
          <div className="facts__row">
            <dt>Визит</dt>
            <dd>
              <span className="tabular">{visit.value}</span>
              <span className="facts__hint">{visit.hint}</span>
            </dd>
          </div>
        ) : null}
        {request.responsibleName ? (
          <div className="facts__row">
            <dt>Ответственный</dt>
            <dd>{request.responsibleName}</dd>
          </div>
        ) : request.status === 'new' ? (
          <div className="facts__row">
            <dt>Ответственный</dt>
            <dd>
              Ещё не назначен
              <span className="facts__hint">Появится, когда Заявку возьмут в работу</span>
            </dd>
          </div>
        ) : null}
        {accidentId ? (
          <div className="facts__row">
            <dt>Авария</dt>
            <dd>
              <button className="text-action pressable facts__link" type="button" onClick={() => onOpenAccident(accidentId)}>
                Открыть Аварию
              </button>
            </dd>
          </div>
        ) : null}
      </dl>
    </ListGroup>
  );
}

function RequestDescription({ request }: { request: RequestDetails }) {
  const photos = useRequestPhotoUrls(request.photos);
  return (
    <ListGroup id="request-description" title="Описание">
      <div className="request-description">
        <Typography.Text asChild variant="body">
          <p>{request.description}</p>
        </Typography.Text>
        {photos.length > 0 ? (
          <ul className="photo-grid photo-grid--static" aria-label="Фото к Заявке">
            {photos.map((photo, index) => (
              <li className="photo-tile" key={photo.id}>
                <img src={photo.url} alt={`Фото ${index + 1} к Заявке`} loading="lazy" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ListGroup>
  );
}

function Comments({ request, onSend }: { request: RequestDetails; onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const open = request.canComment;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    void onSend(text)
      .then((sent) => { if (sent) setDraft(''); })
      .finally(() => setSending(false));
  };

  return (
    <ListGroup id="request-comments" title="Комментарии" plain>
      {request.comments.length > 0 ? (
        <ol className="comments">
          {request.comments.map((comment) => (
            <li className={`comment comment--${comment.mine ? 'mine' : 'theirs'}`} key={comment.id}>
              {comment.mine ? null : (
                <span className="comment__author">
                  {comment.authorName}
                  {comment.authorRole === 'responsible' ? ' · Ответственный' : ''}
                </span>
              )}
              <p className="comment__text">{comment.text}</p>
              <time className="comment__time" dateTime={comment.at}>
                {formatUpdatedAt(comment.at)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <Typography.Text asChild variant="description" color="secondary">
          <p className="comments__empty">
            {open
              ? 'Комментариев пока нет. Напишите, если нужно что-то уточнить.'
              : 'Комментариев нет.'}
          </p>
        </Typography.Text>
      )}

      {open ? (
        <form className="comment-form" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="comment-draft">
            Комментарий
          </label>
          <textarea
            id="comment-draft"
            className="comment-form__input"
            value={draft}
            rows={1}
            maxLength={COMMENT_LIMIT}
            placeholder="Комментарий"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="comment-form__send pressable"
            type="submit"
            aria-label="Отправить Комментарий"
            disabled={!draft.trim() || sending}
          >
            <PaperPlaneRight className="icon" weight="fill" aria-hidden />
          </button>
        </form>
      ) : null}
    </ListGroup>
  );
}

/** Отмена в два шага: случайное нажатие не отзывает Заявку. */
function CancelRequest({ number, busy, onCancel }: { number: number; busy: boolean; onCancel: () => void }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button className="danger-action pressable" type="button" onClick={() => setAsking(true)}>
        Отменить заявку
      </button>
    );
  }

  return (
    <section className="decision-card reveal" aria-labelledby="cancel-title">
      <Typography.Text asChild variant="title">
        <h2 id="cancel-title">Отменить Заявку № {number}?</h2>
      </Typography.Text>
      <Typography.Text asChild variant="description" color="secondary">
        <p>Ответственный перестанет её выполнять. Если неисправность останется, придётся подать новую.</p>
      </Typography.Text>
      <div className="decision-card__actions">
        <Button size="medium" variant="destructive" stretched loading={busy} onClick={onCancel}>
          Отменить заявку
        </Button>
        <Button size="medium" variant="ghost" stretched disabled={busy} onClick={() => setAsking(false)}>
          Не отменять
        </Button>
      </div>
    </section>
  );
}
