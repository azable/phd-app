import { describe, expect, it } from 'vitest';

import { emptyLayouts, stepsOf, type StepState } from './steps';
import { sharedSlots, type Pointer, type TypeContext } from './type-context';

/** A breadth-first search's states: current and w into vertices, w out of scope at the first. */
const state = (current: number, w: number, absent: string[] = []): StepState =>
  ({
    vertices: ['A', 'B', 'C'],
    current,
    w,
    edges: [{ to: 1 }, { to: 2 }],
    __targets: { current: 'vertices', w: 'vertices', 'edges[0].to': 'vertices' },
    __identities: { vertices: 7 },
    __absent: absent,
    __design: {},
    __frame: {}
  }) as unknown as StepState;

const typesOf = (states: StepState[]) =>
  stepsOf(states, {}, null)
    .drawingOf(0, 'recording', emptyLayouts())
    .context.get('sverlin:types') as TypeContext;

describe('positions at one element', () => {
  it('are apart where no step has them at the same element', () => {
    // w stands in at the first step, at current's element, which records nothing.
    const types = typesOf([state(0, 0, ['w']), state(0, 2), state(1, 2), state(1, 0)]);
    expect(types.apart('current', 'w')).toBe(true);
    // edges[0].to is at B with current at the third step.
    expect(types.apart('current', 'edges[1].to')).toBe(false);
    expect(types.apart('w', 'edges[0].to')).toBe(true);
    // A path no step records is never apart.
    expect(types.apart('current', 'other')).toBe(false);
  });

  it('let pointers never together share a slot, the one at the element drawing', () => {
    const types = {
      apart: (a: string, b: string) => [a, b].sort().join() !== 'i,j'
    } as unknown as TypeContext;
    const at = (path: string, position: number, ref?: true) =>
      ({ path, position, ...(ref ? { ref } : {}) }) as Pointer;
    const [i, j, k] = [at('i', 3), at('j', 3), at('k', 5)];
    // i and j are together at some step, so each keeps a slot; k joins the inner, j's.
    expect(sharedSlots(types, [i, j, k], 3)).toEqual([i, j]);
    expect(sharedSlots(types, [i, j, k], 5)).toEqual([i, k]);
    // Where none is at the element, the first of each slot keeps the room.
    expect(sharedSlots(types, [i, j, k], 0)).toEqual([i, j]);
    // A reference's pointer, or one with no path, shares with none.
    expect(sharedSlots(types, [i, at('r', 5, true)], 5)).toHaveLength(2);
    expect(sharedSlots(undefined, [i, k], 5)).toHaveLength(2);
  });
});
