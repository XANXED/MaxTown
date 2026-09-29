import { describe, expect, it } from 'vitest';
import { APARTMENT_REPAIR_WORK_TYPES } from './index.ts';

describe('Apartment Repair contracts', () => {
  it('keeps the public work catalog stable', () => {
    expect(APARTMENT_REPAIR_WORK_TYPES).toEqual([
      'demolition',
      'drilling',
      'flooring',
      'plumbing',
      'electrical',
      'finishing',
      'furniture',
      'other',
    ]);
  });
});
