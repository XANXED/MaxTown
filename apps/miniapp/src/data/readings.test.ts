import { describe, expect, it } from 'vitest';
import type { Meter } from '@maxtown/shared';
import { checkReading, formatReading, parseReading, windowState } from './readings.ts';

const cold: Meter = {
  id: 'm1',
  kind: 'cold-water',
  title: 'Холодная вода',
  unit: 'м³',
  decimals: 3,
  version: 1,
  previous: { value: 123.456, at: '2026-08-20' },
};

describe('parseReading', () => {
  it('accepts a comma or a dot and spaces between digits', () => {
    expect(parseReading('127,5')).toBe(127.5);
    expect(parseReading(' 1 204.25 ')).toBe(1204.25);
  });

  it('rejects anything that is not a number', () => {
    expect(parseReading('')).toBeNull();
    expect(parseReading('12,3,4')).toBeNull();
    expect(parseReading('двенадцать')).toBeNull();
  });
});

describe('checkReading', () => {
  it('skips an empty field: not every meter has to be sent at once', () => {
    expect(checkReading(cold, '')).toEqual({ kind: 'empty' });
  });

  it('computes consumption since the previous reading', () => {
    expect(checkReading(cold, '127,5')).toEqual({ kind: 'ok', value: 127.5, consumption: 4.044 });
  });

  it('refuses a value below the previous one', () => {
    expect(checkReading(cold, '120')).toEqual({ kind: 'error', message: 'Меньше прошлых Показаний: 123,456 м³' });
  });

  it('refuses too many digits after the comma', () => {
    expect(checkReading(cold, '127,5001')).toEqual({ kind: 'error', message: 'После запятой не больше 3 цифр, как на приборе' });
  });

  it('warns about an unusually large consumption but lets it through', () => {
    const result = checkReading(cold, '1234,5');
    expect(result.kind).toBe('warning');
  });

  it('explains a malformed value', () => {
    expect(checkReading(cold, 'abc')).toEqual({ kind: 'error', message: 'Только цифры, например 127,5' });
  });
});

describe('formatReading', () => {
  it('uses the Russian decimal comma', () => {
    expect(formatReading(4.044, 3)).toBe('4,044');
    expect(formatReading(1204.2, 1)).toBe('1 204,2');
  });
});

describe('windowState', () => {
  const window = { from: '2026-09-15', to: '2026-09-25' };

  it('is open inside the dates and closed outside', () => {
    expect(windowState(window, new Date(2026, 8, 20))).toBe('open');
    expect(windowState(window, new Date(2026, 8, 25, 23))).toBe('open');
    expect(windowState(window, new Date(2026, 8, 10))).toBe('not-yet');
    expect(windowState(window, new Date(2026, 8, 26))).toBe('closed');
  });
});
