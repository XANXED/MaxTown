import { describe, expect, it } from 'vitest';
import { initialStatus, parseDemoMode } from './loadable.ts';

describe('demo mode', () => {
  it('reads a known mode from the query string', () => {
    expect(parseDemoMode('?demo=filled')).toBe('filled');
    expect(parseDemoMode('?x=1&demo=error')).toBe('error');
  });

  it('ignores missing and unknown modes', () => {
    expect(parseDemoMode('')).toBeNull();
    expect(parseDemoMode('?demo=everything')).toBeNull();
  });

  it('starts with skeletons while an example loads and with an error in error mode', () => {
    expect(initialStatus(null)).toBe('ready');
    expect(initialStatus('filled')).toBe('loading');
    expect(initialStatus('loading')).toBe('loading');
    expect(initialStatus('error')).toBe('error');
  });
});
