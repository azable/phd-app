import { describe, expect, it } from 'vitest';

import { engineCentres, type EngineInput } from './engines';
import './layered-engine';
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
const tree: Structure = {
  kind: 'tree',
  nodes: [0, 1, 2],
  root: 0,
  children: new Map([[0, [1, 2]]])
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

// The server loads the layered form's engine (assembly/layout.ts); so does this file.
describe('the layered engine, as on the server', () => {
  it('lays a layered graph out with dagre, each layer further along, nodes kept apart', () => {
    const at = engineCentres(input(diamond));
    const x = (node: number) => at.get(node)!.x;
    expect(x(0)).toBeLessThan(x(1));
    expect(x(1)).toBe(x(2));
    expect(x(2)).toBeLessThan(x(3));
    // Nodes of one layer pack by their own heights, an arrow's room apart.
    expect(Math.abs(at.get(1)!.y - at.get(2)!.y)).toBeGreaterThanOrEqual(30 + 28 - 0.5);
  });

  it('draws a tree drawn layered in its natural form, children in their order', () => {
    const { sizeOf, ...rest } = input(tree);
    expect(engineCentres(input(tree))).toEqual(formCentres('natural', tree, sizeOf, rest));
  });
});
