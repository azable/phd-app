import { describe, expect, it } from 'vitest';

import { keyedRandom } from './arrange';
import { findStructure, formCentres, formsFor, sequenceForms, type Structure } from './forms';

const linked = (count: number, pairs: [number, number][]) =>
  findStructure(
    count,
    pairs.map(([source, target]) => ({ source, target }))
  );

describe('structures', () => {
  it('reads paths and cycles in link order', () => {
    expect(
      linked(4, [
        [2, 0],
        [0, 3],
        [3, 1]
      ])
    ).toEqual({ kind: 'path', nodes: [2, 0, 3, 1] });
    expect(
      linked(3, [
        [0, 1],
        [1, 2],
        [2, 0]
      ])
    ).toMatchObject({ kind: 'cycle', nodes: [0, 1, 2] });
  });

  it('reads a tree depth first, and other acyclic graphs in topological order', () => {
    expect(
      linked(4, [
        [0, 1],
        [0, 2],
        [1, 3]
      ])
    ).toMatchObject({
      kind: 'tree',
      root: 0,
      nodes: [0, 1, 3, 2]
    });
    expect(
      linked(4, [
        [1, 2],
        [0, 2],
        [2, 3]
      ])
    ).toMatchObject({
      kind: 'layers',
      nodes: [0, 1, 2, 3]
    });
  });

  it('reads undirected links away from the first node, as a path, ring, tree, or layers', () => {
    const plain = (count: number, pairs: [number, number][]) =>
      findStructure(
        count,
        pairs.map(([source, target]) => ({ source, target, directed: false }))
      );
    // A path from its first end, whichever way each link was written.
    expect(
      plain(4, [
        [1, 0],
        [1, 2],
        [3, 2]
      ])
    ).toEqual({ kind: 'path', nodes: [0, 1, 2, 3] });
    expect(
      plain(4, [
        [0, 1],
        [2, 1],
        [2, 3],
        [3, 0]
      ])
    ).toMatchObject({ kind: 'cycle', nodes: [0, 1, 2, 3] });
    expect(
      plain(5, [
        [1, 0],
        [0, 2],
        [3, 1],
        [1, 4]
      ])
    ).toMatchObject({ kind: 'tree', root: 0, nodes: [0, 1, 3, 4, 2] });
    // A cycle inside, which directed links could not take, reads in layers by distance.
    expect(
      plain(5, [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 3],
        [3, 4]
      ])
    ).toMatchObject({ kind: 'layers', nodes: [0, 1, 2, 3, 4] });
  });

  it('finds nothing in too few links, or in a graph with a cycle inside', () => {
    expect(linked(3, [[0, 1]])).toBeUndefined();
    expect(
      linked(4, [
        [0, 1],
        [1, 2],
        [2, 1],
        [0, 3]
      ])
    ).toBeUndefined();
  });

  it('offers sequence forms for any structure, as well as forms of its own', () => {
    const tree = linked(4, [
      [0, 1],
      [0, 2],
      [1, 3]
    ]) as Structure;
    const layers = linked(4, [
      [1, 2],
      [0, 2],
      [2, 3]
    ]) as Structure;
    const cycle = linked(3, [
      [0, 1],
      [1, 2],
      [2, 0]
    ]) as Structure;
    for (const structure of [tree, layers, cycle])
      expect(formsFor(structure.kind)).toEqual(expect.arrayContaining([...sequenceForms]));
    expect(formsFor(tree.kind)).toEqual(expect.arrayContaining(['tree-down', 'radial']));
    expect(formsFor(tree.kind)).not.toContain('ring');
    expect(formsFor(layers.kind)).toEqual(expect.arrayContaining(['layers-down', 'layers-right']));
    expect(formsFor(cycle.kind)).toContain('ring');
  });
});

describe('form placement', () => {
  const size = { width: 50, height: 30 };
  const structures = [
    linked(7, [
      [0, 1],
      [0, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [2, 6]
    ]) as Structure,
    linked(6, [
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [4, 5]
    ]) as Structure
  ];

  it('places every node of every form clear of the others, for any seed', () => {
    for (const structure of structures)
      for (const form of formsFor(structure.kind))
        for (const seed of [1, 2, 3, 4]) {
          const centres = formCentres(form, structure, () => size, {
            room: 20,
            random: keyedRandom(seed, form)
          });
          const points = structure.nodes.map((node) => centres.get(node));
          expect(points.every(Boolean), `${form} places every node`).toBe(true);
          for (const [i, p] of points.entries())
            for (const q of points.slice(i + 1))
              expect(
                Math.abs(p!.x - q!.x) >= size.width - 0.5 ||
                  Math.abs(p!.y - q!.y) >= size.height - 0.5,
                `${form} (seed ${seed}) keeps nodes apart`
              ).toBe(true);
        }
  });

  it('rows a snake from its count and its nodes alone, as near a square as they go', () => {
    const rowsOf = (count: number) => {
      const path = linked(
        count,
        Array.from({ length: count - 1 }, (_, i) => [i, i + 1] as [number, number])
      ) as Structure;
      const centres = formCentres('snake', path, () => ({ width: 40, height: 40 }), {
        room: 20,
        random: keyedRandom(1, 'snake')
      });
      return new Set([...centres.values()].map(({ y }) => Math.round(y))).size;
    };
    expect([rowsOf(4), rowsOf(9), rowsOf(16)]).toEqual([2, 3, 4]);
  });

  it('layers an undirected graph by distance, links within a layer lying along it', () => {
    // Dijkstra's graph: A joins B and C, which join each other, D and E; D joins E.
    const graph = findStructure(
      5,
      (
        [
          [0, 1],
          [0, 2],
          [1, 2],
          [1, 3],
          [2, 3],
          [2, 4],
          [3, 4]
        ] as [number, number][]
      ).map(([source, target]) => ({ source, target, directed: false }))
    ) as Structure;
    expect(graph.kind).toBe('layers');
    const centres = formCentres('layers-right', graph, () => size, {
      room: 20,
      random: keyedRandom(1, 'layers')
    });
    const column = (node: number) => Math.round(centres.get(node)!.x);
    expect([column(1), column(3)]).toEqual([column(2), column(4)]);
    expect(new Set([0, 1, 2, 3, 4].map(column)).size).toBe(3);
  });
});
