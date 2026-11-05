import { describe, expect, it } from 'vitest';

import { engineCentres, type EngineInput } from './engines';
import { formCentres, type Structure } from './forms';

const sizes = [
  { width: 40, height: 30 },
  { width: 120, height: 30 },
  { width: 40, height: 30 },
  { width: 40, height: 30 }
];
// 0 → 1, 0 → 2, 1 → 3, 2 → 3: a diamond, two layers between its ends.
const diamond: Structure = {
  kind: 'layers',
  nodes: [0, 1, 2, 3],
  parents: new Map([
    [1, [0]],
    [2, [0]],
    [3, [1, 2]]
  ])
};
const input = (structure: Structure, form: EngineInput['form'] = 'layered'): EngineInput => ({
  structure,
  sizeOf: (node) => sizes[node],
  links: [],
  form,
  room: 60,
  apart: 28,
  random: () => 0.5,
  direction: 'right'
});

describe('layout engines', () => {
  it('draws the layered form as natural where its engine is not loaded, as on the page', () => {
    const { sizeOf, ...rest } = input(diamond);
    expect(engineCentres(input(diamond))).toEqual(formCentres('natural', diamond, sizeOf, rest));
  });

  it('draws every other form by the app’s own forms', () => {
    const { sizeOf, ...rest } = input(diamond, 'snake');
    expect(engineCentres(input(diamond, 'snake'))).toEqual(
      formCentres('snake', diamond, sizeOf, rest)
    );
  });
});
