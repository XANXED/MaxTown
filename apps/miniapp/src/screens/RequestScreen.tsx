import { useState, type FormEvent } from 'react';
import { CheckCircle, FileX, PaperPlaneRight, Prohibit, XCircle } from '@phosphor-icons/react';
import { Button, Textarea, Typography } from '../components/platform-ui.tsx';
import type { RequestDetails } from '@maxtown/shared';
import { categoryVisual } from '../components/categoryVisuals.ts';
import { EmptyState, ErrorState, IconTile, ListGroup, SkeletonRows } from '../components/ui.tsx';
import { requestPlaces } from '../data/categories.ts';
import { formatUpdatedAt, requestStatusLabels, requestStatusTones } from '../data/labels.ts';
import {
  addComment,
  canCancel,
  cancelRequest,
  confirmFix,
  formatVisit,
  reportNotFixed,
  requestTimeline,
  useRequestDetails,
} from '../data/requestDetails.ts';
import { eventRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const COMMENT_LIMIT = 1000;

type RequestScreenProps = {
  id: string;
  navigate: Navigate;
  notify: Notify;
};

/** Карточка Заявки: что с ней сейчас, как она шла, подробности и Комментарии. */
export function RequestScreen({ id, navigate, notify }: RequestScreenProps) {
  const { status, data, retry } = useRequestDetails(id);
  // Действия Жильца меняют карточку на месте; с API здесь будет ответ сервера.
  const [changed, setChanged] = useState<RequestDetails | null>(null);
  const request = changed ?? data;

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

  const update = (next: RequestDetails, message: string) => {
    setChanged(next);
    notify(message);
  };

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <RequestHead request={request} />

        {request.status === 'done' ? (
          <FixDecision
            onConfirm={() => update(confirmFix(request, new Date()), 'Заявка закрыта. Спасибо, что проверили')}
            onNotFixed={(details) =>
              update(
                reportNotFixed(request, new Date(), details),
                'Заявка вернулась в работу. Ответственный увидит ваш ответ',
              )
            }
          />
        ) : (
          <Outcome request={request} />
        )}

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

        <ListGroup id="request-description" title="Описание">
          <div className="request-description">
            <Typography.Text asChild variant="body">
              <p>{request.description}</p>
            </Typography.Text>
            {request.photos.length > 0 ? (
              <ul className="photo-grid photo-grid--static" aria-label="Фото к Заявке">
                {request.photos.map((photo, index) => (
                  <li className="photo-tile" key={photo.id}>
                    <img src={photo.url} alt={`Фото ${index + 1} к Заявке`} loading="lazy" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </ListGroup>

        <Comments
          request={request}
          onSend={(text) => {
            setChanged(addComment(request, text, new Date()));
          }}
        />

        {canCancel(request.status) ? (
          <CancelRequest
            number={request.number}
            onCancel={() => update(cancelRequest(request, new Date()), `Заявка № ${request.number} отменена`)}
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
  onConfirm: () => void;
  onNotFixed: (details: string) => void;
};

/** Выполненная Заявка ждёт ответа Жильца: подтвердить или вернуть в работу. */
function FixDecision({ onConfirm, onNotFixed }: FixDecisionProps) {
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
            <Button type="submit" size="medium" variant="primary" stretched>
              Вернуть в работу
            </Button>
            <Button type="button" size="medium" variant="ghost" stretched onClick={() => setExplaining(false)}>
              Назад к ответу
            </Button>
          </div>
        </form>
      ) : (
        <div className="decision-card__actions">
          <Button size="medium" variant="primary" stretched onClick={onConfirm}>
            Подтвердить исправление
          </Button>
          <Button size="medium" variant="secondary" stretched onClick={() => setExplaining(true)}>
            Не исправлено
          </Button>
        </div>
      )}
    </section>
  );
}

/** Итог Заявки, которая уже не ждёт Жильца: закрыта, отклонена или отменена. */
function Outcome({ request }: { request: RequestDetails }) {
  const last = request.history.at(-1);
  switch (request.status) {
    case 'closed':
      return (
        <aside className="outcome outcome--positive">
          <CheckCircle className="icon" weight="fill" aria-hidden />
          <Typography.Text asChild variant="body">
            <p>Исправление подтверждено, Заявка закрыта.</p>
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
            <p>Вы отменили эту Заявку.</p>
          </Typography.Text>
        </aside>
      );
    default:
      return null;
  }
}

function RequestFacts({ request, onOpenAccident }: { request: RequestDetails; onOpenAccident: (id: string) => void }) {
  const place = requestPlaces.find(({ value }) => value === request.place)?.label ?? '';
  const visit = request.visit ? formatVisit(request.visit) : null;
  const { accidentId } = request;

  return (
    <ListGroup id="request-facts" title="Подробности">
      <dl className="facts">
        <div className="facts__row">
          <dt>Где</dt>
          <dd>{place}</dd>
        </div>
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

/** Комментарии нужны, пока по Заявке ещё что-то происходит. */
function acceptsComments(request: RequestDetails): boolean {
  return request.status !== 'closed' && request.status !== 'cancelled';
}

function Comments({ request, onSend }: { request: RequestDetails; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const open = acceptsComments(request);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
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
              ? 'Комментариев пока нет. Напишите, если нужно что-то уточнить у Ответственного.'
              : 'Комментариев не было.'}
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
            disabled={!draft.trim()}
          >
            <PaperPlaneRight className="icon" weight="fill" aria-hidden />
          </button>
        </form>
      ) : null}
    </ListGroup>
  );
}

/** Отмена в два шага: случайное нажатие не отзывает Заявку. */
function CancelRequest({ number, onCancel }: { number: number; onCancel: () => void }) {
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
        <Button size="medium" variant="destructive" stretched onClick={onCancel}>
          Отменить заявку
        </Button>
        <Button size="medium" variant="ghost" stretched onClick={() => setAsking(false)}>
          Не отменять
        </Button>
      </div>
    </section>
  );
}
