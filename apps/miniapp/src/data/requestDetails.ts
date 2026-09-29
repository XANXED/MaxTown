import type { RequestDetails, RequestStatus, RequestVisit } from '@maxtown/shared';

// Карточка Заявки: ход по статусам и подписи. Переходы по CONTEXT.md:
// Новая → В работе → Выполненная (ждёт ответа Жильца) → Закрытая; «нет» на
// Выполненной возвращает Заявку в работу. Отклоняет Ответственный, отменяет
// сам Жилец. Что разрешено сейчас, решает сервер: карточка приходит с actions.

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
export function requestTimeline(request: Pick<RequestDetails, 'status' | 'history'>): TimelineStep[] {
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

/** YYYY-MM-DD по местному времени телефона: «сегодня» для Жильца, а не для UTC. */
export function localIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** День Визита из выбора в форме: «Сегодня», «Завтра» или дата из календаря. */
export function visitDayToDate(choice: 'today' | 'tomorrow' | 'date', picked: string, now: Date = new Date()): string | undefined {
  if (choice === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(picked) ? picked : undefined;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (choice === 'tomorrow' ? 1 : 0));
  return localIsoDay(day);
}
