import { describe, expect, it } from 'vitest';
import { apartmentRepairState, normalizeWorkTypes } from './model.ts';

describe('Apartment Repair model', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');

  it.each([
    [{ startsAt: '2026-09-29T13:00:00.000Z', endsAt: '2026-09-29T15:00:00.000Z', completedAt: null, cancelledAt: null }, 'scheduled'],
    [{ startsAt: '2026-09-29T11:00:00.000Z', endsAt: '2026-09-29T15:00:00.000Z', completedAt: null, cancelledAt: null }, 'active'],
    [{ startsAt: '2026-09-29T09:00:00.000Z', endsAt: '2026-09-29T11:00:00.000Z', completedAt: null, cancelledAt: null }, 'completed'],
    [{ startsAt: '2026-09-29T11:00:00.000Z', endsAt: '2026-09-29T15:00:00.000Z', completedAt: '2026-09-29T11:30:00.000Z', cancelledAt: null }, 'completed'],
    [{ startsAt: '2026-09-29T13:00:00.000Z', endsAt: '2026-09-29T15:00:00.000Z', completedAt: null, cancelledAt: '2026-09-29T11:30:00.000Z' }, 'cancelled'],
  ] as const)('derives lifecycle state', (repair, expected) => {
    expect(apartmentRepairState(repair, now)).toBe(expected);
  });

  it('deduplicates known work types and rejects an unknown type', () => {
    expect(normalizeWorkTypes(['drilling', 'drilling', 'plumbing'])).toEqual(['drilling', 'plumbing']);
    expect(normalizeWorkTypes(['drilling', 'party'])).toBeNull();
    expect(normalizeWorkTypes([])).toBeNull();
  });
});
