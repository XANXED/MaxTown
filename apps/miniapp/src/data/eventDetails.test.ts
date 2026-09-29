import { describe, expect, it } from 'vitest';
import type { HouseEventDetails } from '@maxtown/shared';
import { eventPeriod, eventPhase, eventPhaseLabel, formatEventTime, formatRange, formatSince } from './eventDetails.ts';

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();

function event(overrides: Partial<HouseEventDetails>): HouseEventDetails {
  return {
    id: 'e1',
    kind: 'planned-outage',
    title: 'Отключение горячей воды',
    description: '',
    startsAt: at(12, 9),
    endsAt: at(14, 21),
    systems: ['Вода'],
    advice: [],
    ...overrides,
  };
}

describe('eventPhase', () => {
  it('follows a planned outage from upcoming to finished', () => {
    const outage = event({});
    expect(eventPhase(outage, new Date(2026, 9, 10))).toBe('upcoming');
    expect(eventPhase(outage, new Date(2026, 9, 13))).toBe('ongoing');
    expect(eventPhase(outage, new Date(2026, 9, 15))).toBe('finished');
  });

  it('keeps an accident open until it is resolved, even without an end time', () => {
    const accident = event({ kind: 'accident', endsAt: undefined, startsAt: at(12, 8) });
    expect(eventPhase(accident, new Date(2026, 9, 20))).toBe('ongoing');
    expect(eventPhase({ ...accident, resolvedAt: at(12, 11) }, new Date(2026, 9, 20))).toBe('finished');
  });
});

describe('eventPhaseLabel', () => {
  it('speaks the language of each kind', () => {
    expect(eventPhaseLabel('accident', 'ongoing')).toBe('Открыта');
    expect(eventPhaseLabel('accident', 'finished')).toBe('Закрыта');
    expect(eventPhaseLabel('planned-outage', 'upcoming')).toBe('Запланировано');
    expect(eventPhaseLabel('planned-outage', 'ongoing')).toBe('Идёт сейчас');
    expect(eventPhaseLabel('announcement', 'ongoing')).toBeNull();
  });
});

describe('formatEventTime', () => {
  it('shows day, month and time', () => {
    expect(formatEventTime(at(12, 9))).toBe('12 октября, 09:00');
  });
});

describe('подписи периода', () => {
  it('собирает период по времени телефона', () => {
    expect(formatRange(at(12, 9), at(14, 21))).toBe('12–14 октября');
    expect(formatRange(new Date(2026, 9, 20, 10).toISOString(), new Date(2026, 9, 20, 16).toISOString())).toBe('20 октября, 10:00–16:00');
    expect(formatRange(at(16, 19))).toBe('16 октября, 19:00');
    expect(formatRange(new Date(2026, 8, 30, 9).toISOString(), at(2, 21))).toBe('30 сентября – 2 октября');
  });

  it('открытая Авария — «с 08:40» сегодня и с датой раньше', () => {
    const opened = new Date(2026, 9, 12, 8, 40).toISOString();
    expect(formatSince(opened, new Date(2026, 9, 12, 13))).toBe('с 08:40');
    expect(formatSince(opened, new Date(2026, 9, 13, 9))).toBe('с 12 октября, 08:40');
    expect(eventPeriod({ kind: 'accident', startsAt: opened }, new Date(2026, 9, 12, 13))).toBe('с 08:40');
    expect(eventPeriod({ kind: 'accident', startsAt: opened, resolvedAt: new Date(2026, 9, 12, 14, 10).toISOString() })).toBe('12 октября, 08:40–14:10');
  });
});
