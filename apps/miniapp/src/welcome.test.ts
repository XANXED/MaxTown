import { describe, expect, it } from 'vitest';
import { hasSeenWelcome, markWelcomeSeen } from './welcome.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const brokenStorage = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('blocked');
  },
};

describe('welcome flag', () => {
  it('is not set on first launch', () => {
    expect(hasSeenWelcome(memoryStorage())).toBe(false);
  });

  it('is remembered after the welcome screen', () => {
    const storage = memoryStorage();
    markWelcomeSeen(storage);
    expect(hasSeenWelcome(storage)).toBe(true);
  });

  it('survives unavailable storage', () => {
    expect(() => markWelcomeSeen(brokenStorage)).not.toThrow();
    expect(hasSeenWelcome(brokenStorage)).toBe(false);
    expect(hasSeenWelcome(undefined)).toBe(false);
  });
});
