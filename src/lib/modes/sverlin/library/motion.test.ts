import { describe, expect, it } from 'vitest';

import { pairByRole } from './motion';

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
