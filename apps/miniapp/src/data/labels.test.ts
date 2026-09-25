import { describe, expect, it } from 'vitest';
import { formatUpdatedAt, requestStatusLabels, requestStatusTones } from './labels.ts';

describe('request status labels', () => {
  it('has a Russian label and a tone for every status', () => {
    for (const status of Object.keys(requestStatusLabels) as Array<keyof typeof requestStatusLabels>) {
      expect(requestStatusLabels[status]).toMatch(/^[А-ЯЁ]/);
      expect(requestStatusTones[status]).toBeDefined();
    }
  });

  it('highlights a completed request that waits for the resident', () => {
    expect(requestStatusTones.done).toBe('themed');
  });
});

describe('formatUpdatedAt', () => {
  const now = new Date(2026, 8, 25, 15, 0);

  it('shows today with time', () => {
    expect(formatUpdatedAt(new Date(2026, 8, 25, 10, 24).toISOString(), now)).toBe('Сегодня, 10:24');
  });

  it('shows yesterday with time', () => {
    expect(formatUpdatedAt(new Date(2026, 8, 24, 18, 10).toISOString(), now)).toBe('Вчера, 18:10');
  });

  it('shows a short date for older updates', () => {
    expect(formatUpdatedAt(new Date(2026, 8, 12, 9, 0).toISOString(), now)).toBe('12 сент.');
  });
});
