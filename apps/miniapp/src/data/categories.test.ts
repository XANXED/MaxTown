import { describe, expect, it } from 'vitest';
import { houseSystems, requestCategories } from './categories.ts';

describe('categories', () => {
  it('makes every System a Category', () => {
    for (const system of houseSystems) {
      expect(requestCategories).toContain(system);
    }
  });

  it('has no duplicate Categories', () => {
    expect(new Set(requestCategories).size).toBe(requestCategories.length);
  });
});
