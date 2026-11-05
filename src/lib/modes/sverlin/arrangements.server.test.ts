import { describe, expect, it } from 'vitest';

import { rankedArrangements } from '$lib/shared/readability';

import { arrangementDesigns } from './arrangements.server';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfsUndirected from './fixtures/bfs-undirected.sverlin?raw';
import heap from './fixtures/heap-tree.sverlin?raw';
import { crossingsOf } from './layout.server';

describe('arrangements laid out by the server', () => {
  it('tries every form and direction, then a few seeds, at most twelve', () => {
    const space = {
      'Graph.form': ['natural', 'line', 'snake'],
      'Graph.direction': ['down', 'right'],
      'Graph.layoutSeed': [1, 2, 3, 4, 5]
    };
    const values = { 'Graph.form': 'natural', 'Graph.direction': 'right', 'Graph.layoutSeed': 1 };
    const designs = arrangementDesigns(space, values);
    expect(designs).toContainEqual({ 'Graph.form': 'line', 'Graph.direction': 'down' });
    expect(designs).not.toContainEqual({ 'Graph.form': 'natural', 'Graph.direction': 'right' });
    expect(designs.filter((design) => 'Graph.layoutSeed' in design)).toEqual([
      { 'Graph.layoutSeed': 2 },
      { 'Graph.layoutSeed': 3 },
      { 'Graph.layoutSeed': 4 }
    ]);
    expect(arrangementDesigns({ 'Cell.fill': ['none'] }, {})).toEqual([]);
  });

  it(
    "measures a graph's other arrangements with its own, each drawn differently, ranked",
    { timeout: 60_000 },
    async () => {
      const prepared = prepareSvelteComponent(bfsUndirected);
      const plain = await bundlePresentation(prepared, 1);
      expect(plain.layout.arrangements).toBeUndefined();
      const { layout, variant } = await bundlePresentation(prepared, 1, {}, { arrange: true });
      const arrangements = layout.arrangements ?? [];
      expect(arrangements.length).toBeGreaterThan(2);
      const shown = arrangements.find(({ shown }) => shown);
      expect(shown?.values['Graph.form']).toBe(variant['Graph.form']);
      expect(shown?.readability).toEqual(layout.readability);
      const ranked = rankedArrangements(arrangements);
      expect(new Set(ranked.map(({ values }) => JSON.stringify(values))).size).toBe(ranked.length);
    }
  );

  it('measures none for a page with no free layout', { timeout: 60_000 }, async () => {
    const { layout } = await bundlePresentation(
      prepareSvelteComponent(heap),
      1,
      {},
      {
        arrange: true
      }
    );
    expect(layout.arrangements).toBeUndefined();
  });

  it('counts links whose lines cross, never two meeting at an end', () => {
    const edge = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    const span = (edges: ReturnType<typeof edge>[]) =>
      ['1:1', { edges }] as unknown as Parameters<typeof crossingsOf>[0]['spans'][number];
    expect(crossingsOf({ spans: [span([edge(0, 0, 10, 10), edge(0, 10, 10, 0)])] })).toBe(1);
    expect(crossingsOf({ spans: [span([edge(0, 0, 10, 10), edge(10, 10, 20, 0)])] })).toBe(0);
  });
});
