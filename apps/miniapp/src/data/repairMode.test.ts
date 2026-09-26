import { describe, expect, it } from 'vitest';
import { fromDateTimeLocal, toDateTimeLocal } from './repairMode.ts';

describe('repair mode date input conversion', () => {
  it('round-trips local date/time values through ISO timestamps', () => {
    const input = '2026-09-27T18:45';
    expect(toDateTimeLocal(fromDateTimeLocal(input)!)).toBe(input);
  });

  it('keeps an empty optional completion time empty', () => {
    expect(fromDateTimeLocal('')).toBeNull();
    expect(toDateTimeLocal(null)).toBe('');
  });
});
