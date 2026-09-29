import { describe, expect, it } from 'vitest';
import { canTransitionRepair } from './repair-lifecycle.ts';

describe('repair lifecycle', () => {
  it('allows only the documented next statuses', () => {
    expect(canTransitionRepair('planned', 'in_progress')).toBe(true);
    expect(canTransitionRepair('planned', 'cancelled')).toBe(true);
    expect(canTransitionRepair('in_progress', 'paused')).toBe(true);
    expect(canTransitionRepair('in_progress', 'completed')).toBe(true);
    expect(canTransitionRepair('paused', 'in_progress')).toBe(true);
    expect(canTransitionRepair('paused', 'completed')).toBe(true);
    expect(canTransitionRepair('completed', 'in_progress', 'Работы возобновлены')).toBe(true);
  });

  it('rejects invalid, repeated, terminal and unexplained reopen transitions', () => {
    expect(canTransitionRepair('planned', 'completed')).toBe(false);
    expect(canTransitionRepair('in_progress', 'planned')).toBe(false);
    expect(canTransitionRepair('completed', 'in_progress')).toBe(false);
    expect(canTransitionRepair('completed', 'in_progress', '   ')).toBe(false);
    expect(canTransitionRepair('cancelled', 'planned')).toBe(false);
    expect(canTransitionRepair('paused', 'paused')).toBe(false);
  });
});
