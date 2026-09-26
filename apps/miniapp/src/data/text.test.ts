import { describe, expect, it } from 'vitest';
import type { RequestSummary } from '@maxtown/shared';
import { filterRequests, requestsSummary } from './requestFilters.ts';
import { glueNumberSign, glueRanges, greeting, plural } from './text.ts';

const forms: [string, string, string] = ['Заявка', 'Заявки', 'Заявок'];

describe('plural', () => {
  it('picks the Russian form by number', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, forms))).toEqual([
      'Заявка',
      'Заявки',
      'Заявок',
      'Заявок',
      'Заявок',
      'Заявка',
      'Заявки',
      'Заявок',
      'Заявок',
    ]);
  });
});

describe('greeting', () => {
  it('depends on the time of day', () => {
    expect(greeting(new Date(2026, 8, 25, 8))).toBe('Доброе утро');
    expect(greeting(new Date(2026, 8, 25, 14))).toBe('Добрый день');
    expect(greeting(new Date(2026, 8, 25, 20))).toBe('Добрый вечер');
    expect(greeting(new Date(2026, 8, 25, 2))).toBe('Доброй ночи');
  });

  it('adds the first name when known', () => {
    expect(greeting(new Date(2026, 8, 25, 20), 'Анна')).toBe('Добрый вечер, Анна');
  });
});

const request = (id: string, status: RequestSummary['status']): RequestSummary => ({
  id,
  number: 1,
  category: 'Вода',
  title: 'Течёт',
  status,
  updatedAt: '2026-09-25T10:00:00Z',
});

describe('request filters', () => {
  const requests = [request('a', 'new'), request('b', 'done'), request('c', 'closed'), request('d', 'rejected')];

  it('splits active and closed requests', () => {
    expect(filterRequests(requests, 'all')).toHaveLength(4);
    expect(filterRequests(requests, 'active').map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterRequests(requests, 'closed').map((r) => r.id)).toEqual(['c', 'd']);
  });

  it('summarises the count and requests awaiting confirmation', () => {
    expect(requestsSummary(requests)).toBe('4 Заявки, 1 ждёт подтверждения');
    expect(requestsSummary([request('a', 'new')])).toBe('1 Заявка');
  });
});

describe('glueNumberSign', () => {
  it('keeps the number sign with its number', () => {
    expect(glueNumberSign('Визит по Заявке № 2458')).toBe('Визит по Заявке №\u00a02458');
    expect(glueNumberSign('№ дома')).toBe('№ дома');
  });
});

describe('glueRanges', () => {
  it('joins a range after the dash but keeps other breaks', () => {
    expect(glueRanges('Пн–пт 8:00–20:00, сб')).toBe('Пн–\u2060пт 8:00–\u206020:00, сб');
  });
});
