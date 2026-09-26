import type { RequestComment, RequestDetails, RequestStatus, RequestVisit } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';

// Карточка Заявки: ход по статусам и действия Жильца. Переходы по CONTEXT.md:
// Новая → В работе → Выполненная (ждёт ответа Жильца) → Закрытая; «нет» на
// Выполненной возвращает Заявку в работу. Отклоняет Ответственный, отменяет
// сам Жилец. Пока API нет, действия меняют только то, что видно на экране.

export type TimelineStep = {
  key: string;
  status: RequestStatus;
  label: string;
  state: 'past' | 'current' | 'upcoming';
  /** ISO 8601; у будущих шагов нет. */
  at?: string;
  note?: string;
};

const stepLabels: Record<RequestStatus, string> = {
  new: 'Отправлена',
  'in-progress': 'Взята в работу',
  done: 'Выполнена',
  closed: 'Закрыта',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

/** Основной путь Заявки; остальные статусы его обрывают. */
const mainPath: RequestStatus[] = ['new', 'in-progress', 'done', 'closed'];

const terminal = new Set<RequestStatus>(['closed', 'rejected', 'cancelled']);

/** Шаги для экрана: пройденные из истории, текущий и те, что ещё впереди. */
export function requestTimeline(request: RequestDetails): TimelineStep[] {
  const passed = request.history.map((change, index): TimelineStep => {
    const reopened = change.status === 'in-progress' && request.history[index - 1]?.status === 'done';
    return {
      key: `${index}-${change.status}`,
      status: change.status,
      label: reopened ? 'Возвращена в работу' : stepLabels[change.status],
      state: index === request.history.length - 1 ? 'current' : 'past',
      at: change.at,
      note: change.note,
    };
  });

  if (terminal.has(request.status)) return passed;

  const ahead = mainPath.slice(mainPath.indexOf(request.status) + 1).map(
    (status): TimelineStep => ({ key: `next-${status}`, status, label: stepLabels[status], state: 'upcoming' }),
  );
  return [...passed, ...ahead];
}

/** Отменить можно, пока Ответственный не сообщил об исправлении. */
export function canCancel(status: RequestStatus): boolean {
  return status === 'new' || status === 'in-progress';
}

function withStatus(request: RequestDetails, status: RequestStatus, now: Date, note?: string): RequestDetails {
  const at = now.toISOString();
  return {
    ...request,
    status,
    updatedAt: at,
    history: [...request.history, note ? { status, at, note } : { status, at }],
  };
}

function residentComment(text: string, now: Date): RequestComment {
  return {
    id: `local-${now.getTime()}`,
    authorName: 'Вы',
    authorRole: 'resident',
    mine: true,
    text,
    at: now.toISOString(),
  };
}

/** Жилец подтвердил исправление: Выполненная Заявка закрывается. */
export function confirmFix(request: RequestDetails, now: Date): RequestDetails {
  if (request.status !== 'done') return request;
  return withStatus(request, 'closed', now);
}

/** Жилец ответил «не исправлено»: Заявка возвращается в работу, пояснение — Комментарием. */
export function reportNotFixed(request: RequestDetails, now: Date, details = ''): RequestDetails {
  if (request.status !== 'done') return request;
  const reopened = withStatus(request, 'in-progress', now, 'Вы ответили: не исправлено');
  const text = details.trim();
  return text ? { ...reopened, comments: [...reopened.comments, residentComment(text, now)] } : reopened;
}

export function cancelRequest(request: RequestDetails, now: Date): RequestDetails {
  if (!canCancel(request.status)) return request;
  return withStatus(request, 'cancelled', now);
}

export function addComment(request: RequestDetails, text: string, now: Date): RequestDetails {
  const trimmed = text.trim();
  if (!trimmed) return request;
  return { ...request, comments: [...request.comments, residentComment(trimmed, now)] };
}

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Визит для строки карточки: время, если назначено, иначе выбранный день. */
export function formatVisit(visit: RequestVisit): { value: string; hint: string } {
  if (visit.scheduledAt) {
    const date = new Date(visit.scheduledAt);
    return {
      value: `${dayFormat.format(date)}, ${timeFormat.format(date)}`,
      hint: 'Время назначил Ответственный',
    };
  }
  const [year, month, day] = visit.preferredDate.split('-').map(Number);
  return {
    value: dayFormat.format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)),
    hint: 'Время назначит Ответственный',
  };
}

/** Карточка Заявки. Без API — не найдена; примеры для dev — см. loadable.ts. */
export function useRequestDetails(id: string): Loadable<RequestDetails | null> {
  return useLoadable<RequestDetails | null>(null, ({ sampleRequestDetails }) => sampleRequestDetails(id));
}
