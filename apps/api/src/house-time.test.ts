import { describe, expect, it } from 'vitest';
import { formatHouseTime } from './house-time.ts';

describe('formatHouseTime', () => {
  it('пишет время по поясу Дома, а не сервера', () => {
    expect(formatHouseTime(new Date('2026-10-12T06:00:00Z'))).toBe('12 октября, 09:00');
    expect(formatHouseTime(new Date('2026-10-12T22:30:00Z'))).toBe('13 октября, 01:30');
  });
});
