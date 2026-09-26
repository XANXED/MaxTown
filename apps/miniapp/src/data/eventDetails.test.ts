import { describe, expect, it } from 'vitest';
import type { HouseEventDetails } from '@maxtown/shared';
import { eventPhase, eventPhaseLabel, formatEventTime } from './eventDetails.ts';

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();

function event(overrides: Partial<HouseEventDetails>): HouseEventDetails {
  return {
    id: 'e1',
    kind: 'planned-outage',
    title: 'Отключение горячей воды',
    period: '12–14 октября',
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
