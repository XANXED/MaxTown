import { describe, expect, it } from 'vitest';
import { tariffFreshness } from './houseServices.ts';

describe('house tariff freshness', () => {
  it('marks a tariff expired after its end date', () => {
    expect(tariffFreshness({ checkedOn: '2026-09-01', endsOn: '2026-09-27' }, '2026-09-28')).toBe('expired');
  });

  it('marks old tariff checks stale, while current checks remain current', () => {
    expect(tariffFreshness({ checkedOn: '2026-05-01', endsOn: null }, '2026-09-28')).toBe('stale');
    expect(tariffFreshness({ checkedOn: '2026-09-01', endsOn: null }, '2026-09-28')).toBe('current');
  });
});
