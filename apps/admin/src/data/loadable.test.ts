import { describe, expect, it } from 'vitest';
import { parseDemoMode } from './loadable.ts';

describe('parseDemoMode', () => {
  it('reads only known demo modes', () => {
    expect(parseDemoMode('?demo=filled')).toBe('filled');
    expect(parseDemoMode('?demo=anything')).toBeNull();
    expect(parseDemoMode('')).toBeNull();
  });
});
