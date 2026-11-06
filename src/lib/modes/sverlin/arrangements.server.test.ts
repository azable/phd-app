import { describe, expect, it } from 'vitest';

import { rankedArrangements } from './assistant/arrangements.server';

import { arrangementDesigns } from './arrangements.server';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfsReferences from './fixtures/bfs-references.sverlin?raw';
import bfsUndirected from './fixtures/bfs-undirected.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
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

  it(
    'ranks arrangements laid out at representative steps as it ranks them laid out at every step',
    { timeout: 120_000 },
    async () => {
      const prepared = prepareSvelteComponent(bfsReferences);
      const top = async (arrangeSteps: 'every' | 'representative') => {
        const { layout } = await bundlePresentation(
          prepared,
          1,
          {},
          // No budget: under load the every-step run would stop early and rank fewer.
          { arrange: true, arrangeSteps, arrangeBudgetMs: Number.POSITIVE_INFINITY }
        );
        return rankedArrangements(layout.arrangements ?? [])
          .slice(0, 3)
          .map(({ values }) => JSON.stringify(values));
      };
      const representative = await top('representative');
      expect(representative.length).toBeGreaterThan(1);
      expect(representative).toEqual(await top('every'));
    }
  );

  it(
    'arranges a tree drawn by a view of its reference type in each form, links ending at its nodes',
    { timeout: 120_000 },
    async () => {
      // bst draws its children with <View of="NodeRef" name="NextLink"><Link to={this} /></View>.
      const { layout } = await bundlePresentation(
        prepareSvelteComponent(bst),
        1,
        {},
        { arrange: true }
      );
      const forms = new Set((layout.arrangements ?? []).map(({ values }) => values['Tree.form']));
      expect(forms.size).toBeGreaterThan(3);
    }
  );

  it('offers forms to graphs whose links a view of an edge, or a field list, draws', () => {
    // Dijkstra's <View of="Edge"><Link from={this.from} to={this.to}>; bfs-references'
    // {#each this.out as w}<Link to={w} />, both layered graphs.
    for (const source of [dijkstra, bfsReferences])
      expect(prepareSvelteComponent(source).design.space['Graph.form']).toContain('natural');
  });

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

  it(
    'draws the layered form with dagre on the server only, offered where links make layers',
    { timeout: 120_000 },
    async () => {
      const prepared = prepareSvelteComponent(dijkstra);
      expect(prepared.design.space['Graph.form']).toContain('layered');
      // A tree is not offered it: dagre orders a layer its own way, a tree's children by theirs.
      expect(prepareSvelteComponent(bst).design.space['Tree.form']).not.toContain('layered');
      const natural = await bundlePresentation(prepared, 1, {});
      const layered = await bundlePresentation(prepared, 1, {
        chosen: { 'Graph.form': 'layered' }
      });
      // dagre packs each layer by its own nodes, so the graph draws larger than in its natural form.
      expect(layered.layout.readability!.scale).toBeGreaterThan(natural.layout.readability!.scale);
      // dagre runs in the server's layout alone: its ranker names never reach the page.
      for (const { javascript } of [natural, layered])
        expect(javascript).not.toMatch(/network-simplex|longest-path|tight-tree/u);
    }
  );
});
