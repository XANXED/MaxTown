import { describe, expect, it } from 'vitest';
import { parsePollOptions } from './community.ts';

describe('poll option input', () => {
  it('splits one option per line and ignores blank lines', () => {
    expect(parsePollOptions('За\n\nПротив\nВоздержаться  ')).toEqual(['За', 'Против', 'Воздержаться']);
  });

  it('does not silently merge or remove duplicate choices', () => {
    expect(parsePollOptions('Да\nДа')).toEqual(['Да', 'Да']);
  });
});
