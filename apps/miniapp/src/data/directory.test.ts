import { describe, expect, it } from 'vitest';
import type { Place } from '@maxtown/shared';
import { emergencyNumbers, formatDistance, mapLink, phoneHref, placeFilters } from './directory.ts';

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

describe('placeFilters', () => {
  const place = (id: string, category: Place['category']): Place => ({ id, title: id, category, address: '', distance: 1 });

  it('offers only categories that exist, with counts', () => {
    const filters = placeFilters([place('a', 'clinic'), place('b', 'pharmacy'), place('c', 'pharmacy')]);
    expect(filters).toEqual([
      { value: 'all', label: 'Все', count: 3 },
      { value: 'clinic', label: 'Поликлиники', count: 1 },
      { value: 'pharmacy', label: 'Аптеки', count: 2 },
    ]);
  });
});

describe('mapLink', () => {
  it('searches the address on the map', () => {
    expect(mapLink('ул. Лесная, 20')).toBe('https://yandex.ru/maps/?text=%D1%83%D0%BB.%20%D0%9B%D0%B5%D1%81%D0%BD%D0%B0%D1%8F%2C%2020');
  });
});
