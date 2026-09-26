import { describe, expect, it } from 'vitest';
import type { RequestDetails, RequestStatus } from '@maxtown/shared';
import {
  addComment,
  canCancel,
  cancelRequest,
  confirmFix,
  formatVisit,
  reportNotFixed,
  requestTimeline,
} from './requestDetails.ts';

const at = (hour: number) => new Date(2026, 8, 25, hour).toISOString();

function request(statuses: RequestStatus[]): RequestDetails {
  return {
    id: 'r1',
    number: 2458,
    category: 'Сантехника',
    title: 'Течёт кран',
    status: statuses.at(-1) ?? 'new',
    updatedAt: at(statuses.length),
    description: 'Течёт кран на кухне',
    place: 'apartment',
    photos: [],
    history: statuses.map((status, index) => ({ status, at: at(index + 1) })),
    comments: [],
  };
}

describe('requestTimeline', () => {
  it('shows the steps still ahead of a new request', () => {
    expect(requestTimeline(request(['new'])).map(({ label, state }) => [label, state])).toEqual([
      ['Отправлена', 'current'],
      ['Взята в работу', 'upcoming'],
      ['Выполнена', 'upcoming'],
      ['Закрыта', 'upcoming'],
    ]);
  });

  it('ends at a terminal status without upcoming steps', () => {
    const steps = requestTimeline(request(['new', 'rejected']));
    expect(steps.map(({ state }) => state)).toEqual(['past', 'current']);
    expect(steps.at(-1)?.label).toBe('Отклонена');
  });

  it('names a request that came back to work after “not fixed”', () => {
    const steps = requestTimeline(request(['new', 'in-progress', 'done', 'in-progress']));
    expect(steps.map(({ label }) => label)).toEqual([
      'Отправлена',
      'Взята в работу',
      'Выполнена',
      'Возвращена в работу',
      'Выполнена',
      'Закрыта',
    ]);
  });
});

describe('request actions', () => {
  const now = new Date(2026, 8, 26, 9);

  it('closes a completed request when the resident confirms the fix', () => {
    const closed = confirmFix(request(['new', 'in-progress', 'done']), now);
    expect(closed.status).toBe('closed');
    expect(closed.history.at(-1)).toEqual({ status: 'closed', at: now.toISOString() });
    expect(closed.updatedAt).toBe(now.toISOString());
  });

  it('returns a completed request to work and keeps the resident’s words as a Comment', () => {
    const reopened = reportNotFixed(request(['new', 'in-progress', 'done']), now, '  Всё ещё капает  ');
    expect(reopened.status).toBe('in-progress');
    expect(reopened.history.at(-1)?.note).toBe('Вы ответили: не исправлено');
    expect(reopened.comments.at(-1)).toMatchObject({ text: 'Всё ещё капает', mine: true, authorRole: 'resident' });
  });

  it('does not add an empty Comment when the resident gives no details', () => {
    expect(reportNotFixed(request(['done']), now, '   ').comments).toHaveLength(0);
  });

  it('ignores actions that do not fit the status', () => {
    const fresh = request(['new']);
    expect(confirmFix(fresh, now)).toBe(fresh);
    expect(reportNotFixed(fresh, now)).toBe(fresh);
  });

  it('lets the resident cancel only a request that is not finished yet', () => {
    expect(canCancel('new')).toBe(true);
    expect(canCancel('in-progress')).toBe(true);
    expect(canCancel('done')).toBe(false);
    expect(canCancel('closed')).toBe(false);
    expect(cancelRequest(request(['new']), now).status).toBe('cancelled');
    const done = request(['done']);
    expect(cancelRequest(done, now)).toBe(done);
  });

  it('adds a trimmed Comment and skips empty text', () => {
    const base = request(['in-progress']);
    expect(addComment(base, '  Жду после 18:00 ', now).comments.at(-1)?.text).toBe('Жду после 18:00');
    expect(addComment(base, '   ', now)).toBe(base);
  });
});

describe('formatVisit', () => {
  it('shows the time when the Responsible has scheduled it', () => {
    expect(formatVisit({ preferredDate: '2026-09-26', scheduledAt: new Date(2026, 8, 26, 10, 30).toISOString() })).toEqual({
      value: '26 сентября, 10:30',
      hint: 'Время назначил Ответственный',
    });
  });

  it('shows the chosen day while the time is not set', () => {
    expect(formatVisit({ preferredDate: '2026-09-27' })).toEqual({
      value: '27 сентября',
      hint: 'Время назначит Ответственный',
    });
  });
});
