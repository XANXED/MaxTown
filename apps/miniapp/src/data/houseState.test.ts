import { describe, expect, it } from 'vitest';
import type { HouseSystemState } from '@maxtown/shared';
import { brokenFirst, houseSummary, knownProblem, systemStatusLine } from './houseState.ts';

const working = (name: string, nextOutage?: HouseSystemState['nextOutage']): HouseSystemState => ({
  name,
  status: 'working',
  nextOutage,
});

describe('houseSummary', () => {
  it('says everything works and mentions the next planned outage', () => {
    expect(houseSummary([working('Вода', { eventId: 'e3', period: '12–14 октября' }), working('Лифты')])).toEqual({
      tone: 'positive',
      title: 'Всё работает',
      description: 'Ближайшее Плановое отключение: Вода, 12–14 октября',
    });
    expect(houseSummary([working('Вода'), working('Лифты')]).description).toBe('Все 2 Системы Дома в порядке');
  });

  it('puts an accident first and names the systems', () => {
    expect(
      houseSummary([
        { name: 'Лифты', status: 'accident', eventId: 'e4', detail: 'с 08:40' },
        { name: 'Вода', status: 'planned-outage', eventId: 'e3', detail: 'до 14 октября' },
        working('Интернет'),
      ]),
    ).toEqual({ tone: 'negative', title: 'Авария: Лифты', description: 'Плановое отключение: Вода' });
  });

  it('reports a planned outage alone and reassures about the rest', () => {
    expect(houseSummary([{ name: 'Вода', status: 'planned-outage' }, working('Лифты')])).toEqual({
      tone: 'attention',
      title: 'Плановое отключение: Вода',
      description: 'Остальные Системы работают',
    });
  });
});

describe('systemStatusLine', () => {
  it('describes each status for a row', () => {
    expect(systemStatusLine({ name: 'Лифты', status: 'accident', detail: 'с 08:40' })).toBe('Авария с\u00a008:40');
    expect(systemStatusLine({ name: 'Вода', status: 'planned-outage', detail: 'до 14 октября' })).toBe(
      'Плановое отключение до\u00a014\u00a0октября',
    );
    expect(systemStatusLine(working('Вода', { eventId: 'e3', period: '12–14 октября' }))).toBe(
      'Работает. Отключение 12–\u206014\u00a0октября',
    );
    expect(systemStatusLine(working('Свет'))).toBe('Работает');
  });
});

describe('brokenFirst', () => {
  it('puts accidents, then planned outages, then working systems', () => {
    const order = brokenFirst([
      working('Свет'),
      { name: 'Вода', status: 'planned-outage' },
      { name: 'Лифты', status: 'accident' },
      working('Интернет'),
    ]).map(({ name }) => name);
    expect(order).toEqual(['Лифты', 'Вода', 'Свет', 'Интернет']);
  });
});

describe('knownProblem', () => {
  const state = {
    address: 'ул. Лесная, 12',
    apartment: '34',
    updatedAt: '2026-09-25T10:00:00Z',
    systems: [working('Электричество'), { name: 'Лифты', status: 'accident' as const, eventId: 'e4', detail: 'с 08:40' }],
  };

  it('finds an open accident on the chosen system', () => {
    expect(knownProblem(state, 'Лифты')?.eventId).toBe('e4');
  });

  it('stays quiet for working systems, categories without a system and guests', () => {
    expect(knownProblem(state, 'Электричество')).toBeNull();
    expect(knownProblem(state, 'Сантехника')).toBeNull();
    expect(knownProblem(null, 'Лифты')).toBeNull();
    expect(knownProblem(state, null)).toBeNull();
  });
});
