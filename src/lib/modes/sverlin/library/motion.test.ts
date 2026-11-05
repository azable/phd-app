import { describe, expect, it } from 'vitest';

import { pairByRole, rerouted } from './motion';

describe('pairing the places a value is drawn between steps', () => {
  it('keeps a value drawn again in a caption from pairing with its vertex, wherever the caption comes', () => {
    const vertex = ['VertexCard', 'Graph', 'Main'];
    const caption = ['Status', 'Main'];
    // The caption first in document order: the vertex still pairs with itself, the caption with none.
    expect(pairByRole([caption, vertex], [vertex])).toEqual([undefined, 0]);
    expect(pairByRole([vertex, caption], [vertex])).toEqual([0, undefined]);
  });

  it('pairs places of one role in document order, as cells of a row', () => {
    const cell = ['Row', 'Main'];
    expect(pairByRole([cell, cell], [cell, cell])).toEqual([0, 1]);
  });

  it('still pairs a value that moved to another place, drawn once before and once now', () => {
    expect(pairByRole([['KeyRow', 'Main']], [['Row', 'Main']])).toEqual([0]);
  });
});

describe('links redrawn between steps', () => {
  it('picks the links drawn anew or along another route, which wait for the moves to end', () => {
    const before = [
      { key: 'a-b', route: 'M0 0L10 10' },
      { key: 'c-d', route: 'M5 5L9 9' }
    ];
    const after = [
      { key: 'a-b', route: 'M0 0L10 10' },
      { key: 'c-d', route: 'M5 7L9 9' },
      { key: 'e-f', route: 'M1 1L2 2' }
    ];
    expect(rerouted(before, after).map(({ key }) => key)).toEqual(['c-d', 'e-f']);
  });
});
