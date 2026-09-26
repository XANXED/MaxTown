import { describe, expect, it } from 'vitest';
import { inviteFromStartParam, matchHouses, parseInviteCode, validateApartment } from './join.ts';

describe('parseInviteCode', () => {
  it('reads the code from an Invitation link', () => {
    expect(parseInviteCode('https://max.ru/maxtown_bot?startapp=inv_K7f2-x9')).toBe('K7f2-x9');
    expect(parseInviteCode('  max.ru/maxtown_bot?startapp=inv_abc123  ')).toBe('abc123');
  });

  it('accepts the bare payload or code', () => {
    expect(parseInviteCode('inv_abc123')).toBe('abc123');
    expect(parseInviteCode('abc123')).toBe('abc123');
  });

  it('rejects text that is not an Invitation', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('https://example.com/?startapp=inv_abc123')).toBeNull();
    expect(parseInviteCode('https://max.ru/maxtown_bot?startapp=promo_abc')).toBeNull();
    expect(parseInviteCode('привет')).toBeNull();
    expect(parseInviteCode('ab')).toBeNull();
  });
});

describe('inviteFromStartParam', () => {
  it('finds an Invitation in the launch parameter', () => {
    expect(inviteFromStartParam('inv_abc123')).toBe('abc123');
    expect(inviteFromStartParam('promo_summer')).toBeNull();
    expect(inviteFromStartParam(undefined)).toBeNull();
  });
});

describe('validateApartment', () => {
  it('accepts a number with an optional letter', () => {
    expect(validateApartment('34')).toBeNull();
    expect(validateApartment(' 112а ')).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(validateApartment('')).toBe('Укажите номер Квартиры');
    expect(validateApartment('кв. 34')).toBe('Только номер, например 34 или 34А');
    expect(validateApartment('0')).toBe('Только номер, например 34 или 34А');
  });
});

describe('matchHouses', () => {
  const houses = [
    { id: 'h1', address: 'ул. Лесная, 12', locality: 'Казань' },
    { id: 'h2', address: 'ул. Лесная, 14', locality: 'Казань' },
    { id: 'h3', address: 'пр. Победы, 3', locality: 'Казань' },
  ];

  it('needs every word and ignores punctuation', () => {
    expect(matchHouses(houses, 'лесная 12').map(({ id }) => id)).toEqual(['h1']);
    expect(matchHouses(houses, 'ул. лесная').map(({ id }) => id)).toEqual(['h1', 'h2']);
  });

  it('returns nothing for an empty query', () => {
    expect(matchHouses(houses, '  ')).toEqual([]);
  });
});
