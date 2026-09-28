import { describe, expect, it } from 'vitest';
import { emergencyNumbers, formatDistance, phoneHref } from './directory.ts';

describe('formatDistance', () => {
  it('shows metres up to a kilometre and kilometres after', () => {
    expect(formatDistance(80)).toBe('80 м');
    expect(formatDistance(349)).toBe('350 м');
    expect(formatDistance(1000)).toBe('1 км');
    expect(formatDistance(1234)).toBe('1,2 км');
  });
});

describe('phoneHref', () => {
  it('keeps only the plus and digits', () => {
    expect(phoneHref('+7 (843) 555-12-34')).toBe('tel:+78435551234');
    expect(phoneHref('112')).toBe('tel:112');
  });
});

describe('emergencyNumbers', () => {
  it('lists the single number first', () => {
    expect(emergencyNumbers[0]?.phone).toBe('112');
  });
});
