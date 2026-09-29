import { describe, expect, it } from 'vitest';
import type { RequestStatus } from '@maxtown/shared';
import { formatVisit, requestTimeline, visitDayToDate } from './requestDetails.ts';

const at = (hour: number) => new Date(2026, 8, 25, hour).toISOString();

function request(statuses: RequestStatus[]) {
  return {
    status: statuses.at(-1) ?? 'new',
    history: statuses.map((status, index) => ({ status, at: at(index + 1) })),
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

describe('visitDayToDate', () => {
  const evening = new Date(2026, 8, 30, 23, 30);

  it('counts today and tomorrow by the phone clock, not UTC', () => {
    expect(visitDayToDate('today', '', evening)).toBe('2026-09-30');
    expect(visitDayToDate('tomorrow', '', evening)).toBe('2026-10-01');
  });

  it('takes the picked day and skips an empty picker', () => {
    expect(visitDayToDate('date', '2026-10-05', evening)).toBe('2026-10-05');
    expect(visitDayToDate('date', '', evening)).toBeUndefined();
  });
});
