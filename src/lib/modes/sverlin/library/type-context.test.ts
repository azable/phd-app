import { describe, expect, it } from 'vitest';

import {
  elementSlot,
  pointsInto,
  reachesInto,
  type Pointer,
  type TypeContext
} from './type-context';

/** A grid step where row is paths[1], at a trace where row also held paths[2]. */
const types = {
  identityOf: (path: string) =>
    ({ paths: 1, 'paths[0]': 2, 'paths[1]': 3, 'paths[2]': 4, row: 3, other: 5 })[path],
  heldBy: (name: string) => (name === 'row' ? new Set([3, 4]) : undefined),
  lengthOf: (path: string) => (path === 'paths' ? 3 : undefined)
} as unknown as TypeContext;
const pointer = (collection: string) => ({ collection, position: 1 }) as Pointer;

describe('pointers', () => {
  it('name the element a slot draws, nested or not', () => {
    expect(elementSlot('values[2]')).toEqual({ collection: 'values', index: 2 });
    expect(elementSlot('paths[1][2]')).toEqual({ collection: 'paths[1]', index: 2 });
    expect(elementSlot('edges[0].to')).toBeUndefined();
  });

  it('point into the row a variable holds this step', () => {
    expect(pointsInto(types, pointer('row'), 'paths[1]')).toBe(true);
    expect(pointsInto(types, pointer('row'), 'paths[2]')).toBe(false);
    expect(pointsInto(undefined, pointer('values'), 'values')).toBe(true);
  });

  it('keep room in every row of a grid whose rows the variable holds', () => {
    expect(reachesInto(types, pointer('row'), 'paths[2]')).toBe(true);
    expect(reachesInto(types, pointer('row'), 'paths[0]')).toBe(true);
    expect(reachesInto(types, pointer('row'), 'other')).toBe(false);
    expect(reachesInto(types, pointer('left'), 'right')).toBe(false);
  });
});
