import { describe, expect, it } from 'vitest';

import { keyedRandom } from './arrange';
import {
  findStructure,
  formCentres,
  forms,
  type Direction,
  type Form,
  type Structure
} from './forms';

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

  it('layers a graph with cycles by distance from its start, and finds nothing without one', () => {
    // 0 starts it; 2 leads back to 1.
    expect(
      linked(4, [
        [0, 1],
        [1, 2],
        [2, 1],
        [0, 3]
      ])
    ).toMatchObject({
      kind: 'layers',
      nodes: [0, 1, 3, 2],
      depths: new Map([
        [0, 0],
        [1, 1],
        [3, 1],
        [2, 2]
      ])
    });
    expect(linked(3, [[0, 1]])).toBeUndefined();
    // Every node has a link in, so nothing starts it.
    expect(
      linked(4, [
        [0, 1],
        [1, 2],
        [2, 0],
        [2, 3],
        [3, 1]
      ])
    ).toBeUndefined();
  });

  it('draws each structure naturally as its own shape, running along its direction', () => {
    const tree = linked(4, [
      [0, 1],
      [0, 2],
      [1, 3]
    ]) as Structure;
    const path = linked(3, [
      [0, 1],
      [1, 2]
    ]) as Structure;
    const cycle = linked(3, [
      [0, 1],
      [1, 2],
      [2, 0]
    ]) as Structure;
    type Ways = { direction?: Direction };
    const centres = (form: Form, structure: Structure, ways: Ways = {}) =>
      formCentres(form, structure, () => ({ width: 40, height: 20 }), {
        room: 20,
        random: keyedRandom(1, form),
        ...ways
      });
    const down: Ways[] = [{}, { direction: 'down' }];
    const across: Ways[] = [{ direction: 'right' }];
    // A tree branches down unless it runs along x; a path is a line, running the same way.
    for (const ways of down) {
      const branched = centres('natural', tree, ways);
      expect(branched.get(1)!.y).toBeGreaterThan(branched.get(0)!.y);
    }
    for (const ways of across) {
      const branched = centres('natural', tree, ways);
      expect(branched.get(1)!.x).toBeGreaterThan(branched.get(0)!.x);
    }
    for (const ways of [...down, ...across])
      expect(centres('natural', path, ways)).toEqual(centres('line', path, ways));
    const column = centres('line', path, { direction: 'down' });
    expect(new Set([...column.values()].map(({ x }) => x)).size).toBe(1);
    // Every sequence form turns with the direction, and a cycle's ring is the same either way.
    const snake = centres('snake', path, { direction: 'down' });
    const across2 = centres('snake', path, { direction: 'right' });
    expect(snake).not.toEqual(across2);
    const spread = (placed: Map<number, { x: number; y: number }>, axis: 'x' | 'y') =>
      Math.max(...[...placed.values()].map((p) => p[axis])) -
      Math.min(...[...placed.values()].map((p) => p[axis]));
    expect(spread(snake, 'y')).toBeGreaterThan(spread(snake, 'x'));
    const ring = centres('natural', cycle);
    for (const ways of [...down, ...across]) expect(centres('natural', cycle, ways)).toEqual(ring);
    const radii = [...ring.values()].map(({ x, y }) => Math.round(Math.hypot(x, y)));
    expect(new Set(radii).size).toBe(1);
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

  it('places every node of every form clear of the others, either way, for any seed', () => {
    for (const structure of structures)
      for (const form of forms)
        for (const direction of [undefined, 'down', 'right'] as const)
          for (const seed of [1, 2, 3, 4]) {
            const centres = formCentres(form, structure, () => size, {
              room: 20,
              random: keyedRandom(seed, form),
              direction
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

  it('gives each subtree of a tree only the room its own nodes need, as a tree of calls narrowing to leaves', () => {
    // Merge sort's calls on 4 values: the whole, two halves, four leaves, each as wide as its part.
    const calls = linked(7, [
      [0, 1],
      [1, 2],
      [1, 3],
      [0, 4],
      [4, 5],
      [4, 6]
    ]) as Structure;
    const widths = [200, 100, 50, 50, 100, 50, 50];
    const centres = formCentres('natural', calls, (node) => ({ width: widths[node], height: 30 }), {
      room: 20,
      random: keyedRandom(1, 'natural')
    });
    const xs = calls.nodes.map((node) => centres.get(node)!.x);
    // The leaves, a value each, sit their own width and a gap apart, not the root's width.
    expect(xs[3] - xs[2]).toBe(70);
    // Each parent sits over the middle of its children.
    expect(xs[1]).toBe((xs[2] + xs[3]) / 2);
    expect(xs[0]).toBe((xs[1] + xs[4]) / 2);
  });

  it('keeps a label’s room only the way links run, nodes in a layer an arrow’s room apart', () => {
    // A leads to B and C, both to D, each link with a label needing 100 px of room.
    const graph = linked(4, [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3]
    ]) as Structure;
    const centres = formCentres('natural', graph, () => ({ width: 60, height: 40 }), {
      room: 100,
      apart: 28,
      random: keyedRandom(1, 'layers'),
      direction: 'down'
    });
    const [a, b, c] = [0, 1, 2].map((node) => centres.get(node)!);
    expect(Math.abs(b.x - c.x)).toBe(60 + 28);
    expect(b.y - a.y).toBe(40 + 100);
  });

  it('keeps nodes a link joins within one layer its room and its label’s apart', () => {
    // Layers by distance from A, as an undirected graph's: B and C share a layer and a link.
    const graph: Structure = {
      kind: 'layers',
      nodes: [0, 1, 2],
      parents: new Map([
        [1, [0]],
        [2, [0, 1]]
      ]),
      depths: new Map([
        [0, 0],
        [1, 1],
        [2, 1]
      ])
    };
    const centres = formCentres('natural', graph, () => ({ width: 60, height: 40 }), {
      room: 100,
      apart: 28,
      random: keyedRandom(1, 'layers'),
      direction: 'down'
    });
    const [b, c] = [1, 2].map((node) => centres.get(node)!);
    expect(Math.abs(b.x - c.x)).toBe(60 + 100);
  });

  it('scatters nodes no further apart than a line steps, never onto each other', () => {
    const count = 10;
    const path = linked(
      count,
      Array.from({ length: count - 1 }, (_, i) => [i, i + 1] as [number, number])
    ) as Structure;
    const node = { width: 60, height: 40 };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const centres = [
        ...formCentres('scatter', path, () => node, {
          room: 30,
          random: keyedRandom(seed, 'scatter')
        }).values()
      ];
      for (const [i, p] of centres.entries())
        for (const q of centres.slice(i + 1))
          expect(Math.abs(p.x - q.x) >= node.width || Math.abs(p.y - q.y) >= node.height).toBe(
            true
          );
      // A cell is a node and its room, so each node's nearest neighbour is a step away, give or take
      // a nudge, as in a line: not a step and a third or a half, as cells once were.
      for (const p of centres) {
        const nearest = Math.min(
          ...centres
            .filter((q) => q !== p)
            .map((q) =>
              Math.max(
                Math.abs(p.x - q.x) / (node.width + 30),
                Math.abs(p.y - q.y) / (node.height + 30)
              )
            )
        );
        expect(nearest).toBeLessThanOrEqual(1.4);
      }
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
    const centres = formCentres('natural', graph, () => size, {
      room: 20,
      random: keyedRandom(1, 'layers'),
      direction: 'right'
    });
    const column = (node: number) => Math.round(centres.get(node)!.x);
    expect([column(1), column(3)]).toEqual([column(2), column(4)]);
    expect(new Set([0, 1, 2, 3, 4].map(column)).size).toBe(3);
  });
});

describe('layered drawing', () => {
  const size = { width: 50, height: 120 };
  const centresOf = (pairs: [number, number][], seed = 1) => {
    const structure = linked(Math.max(...pairs.flat()) + 1, pairs) as Structure;
    expect(structure.kind).toBe('layers');
    return formCentres('natural', structure, () => size, {
      room: 28,
      random: keyedRandom(seed, 'layers'),
      direction: 'down'
    });
  };
  // Whether two straight links cross between their ends.
  const cross = (a: [Point, Point], b: [Point, Point]) => {
    const side = (p: Point, q: Point, r: Point) =>
      Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return (
      side(a[0], a[1], b[0]) * side(a[0], a[1], b[1]) < 0 &&
      side(b[0], b[1], a[0]) * side(b[0], b[1], a[1]) < 0
    );
  };
  type Point = { x: number; y: number };
  const crossings = (pairs: [number, number][], centres: Map<number, Point>) =>
    pairs.flatMap(([s, t], i) =>
      pairs
        .slice(i + 1)
        .filter(([u, v]) =>
          cross([centres.get(s)!, centres.get(t)!], [centres.get(u)!, centres.get(v)!])
        )
    ).length;

  it('draws a breadth-first search graph layer by layer, its start on top', () => {
    // A leads to B and C, both to D, and D to E.
    const bfs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 4]
    ];
    for (const seed of [1, 2, 3]) {
      const centres = centresOf(bfs, seed);
      const [a, b, c, d, e] = [0, 1, 2, 3, 4].map((node) => centres.get(node)!);
      expect(b.y).toBe(c.y);
      expect([a.y < b.y, b.y < d.y, d.y < e.y]).toEqual([true, true, true]);
      // B and C side by side, an arrow's room between them, A, D and E over their middle.
      expect(Math.abs(b.x - c.x)).toBeGreaterThanOrEqual(size.width + 28);
      expect([a.x, d.x, e.x]).toEqual([(b.x + c.x) / 2, (b.x + c.x) / 2, (b.x + c.x) / 2]);
      // Layers a node's height and room for an arrow apart, not much more.
      expect(b.y - a.y).toBeLessThan(size.height + 2 * 28);
    }
  });

  it('orders each layer so links cross as little as they can', () => {
    // Written so that taking each layer in order crosses: 0 leads to 3 and 1 to 2, and a link from
    // 0 skips a layer.
    const graph: [number, number][] = [
      [0, 3],
      [1, 2],
      [0, 4],
      [3, 5],
      [2, 6],
      [4, 5],
      [0, 6]
    ];
    expect(crossings(graph, centresOf(graph))).toBe(0);
  });

  it('starts each layer in an order its seed chooses, so seeds give other arrangements', () => {
    // A leads to B and C, both to D: B and C can sit either way round.
    const bfs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3]
    ];
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const centres = centresOf(bfs, seed);
        return centres.get(1)!.x < centres.get(2)!.x ? 'B left' : 'C left';
      })
    );
    expect(orders).toEqual(new Set(['B left', 'C left']));
    for (const seed of [1, 2, 3]) expect(crossings(bfs, centresOf(bfs, seed))).toBe(0);
  });
});
