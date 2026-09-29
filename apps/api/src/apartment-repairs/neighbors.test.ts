import { describe, expect, it } from 'vitest';
import { neighboringApartmentIds, type ApartmentGridCell } from './neighbors.ts';

describe('neighboringApartmentIds', () => {
  it('returns only occupied cells that share a wall, floor, or ceiling', () => {
    const cells: ApartmentGridCell[] = [
      { apartmentId: 'target', entrance: 1, floor: 5, column: 0 },
      { apartmentId: 'left', entrance: 1, floor: 5, column: -1 },
      { apartmentId: 'right', entrance: 1, floor: 5, column: 1 },
      { apartmentId: 'above', entrance: 1, floor: 6, column: 0 },
      { apartmentId: 'below', entrance: 1, floor: 4, column: 0 },
      { apartmentId: 'diagonal', entrance: 1, floor: 6, column: 1 },
      { apartmentId: 'across-gap', entrance: 1, floor: 5, column: 2 },
      { apartmentId: 'other-entrance', entrance: 2, floor: 5, column: 0 },
    ];

    expect(neighboringApartmentIds(cells, 'target').sort()).toEqual(['above', 'below', 'left', 'right']);
  });

  it('returns no neighbors for an unknown or unplaced apartment', () => {
    const cells: ApartmentGridCell[] = [{ apartmentId: 'unplaced', entrance: null, floor: null, column: null }];

    expect(neighboringApartmentIds(cells, 'missing')).toEqual([]);
    expect(neighboringApartmentIds(cells, 'unplaced')).toEqual([]);
  });
});
