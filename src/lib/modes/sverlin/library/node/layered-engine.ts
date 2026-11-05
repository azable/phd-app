/**
 * The layered form, drawn by dagre (https://github.com/dagrejs/dagre), the Sugiyama framework of
 * Gansner et al.'s dot: ranks by network simplex, crossings reduced layer by layer, coordinates by
 * Brandes and Köpf, every node at its own size, so the nodes of a layer pack by their own widths.
 * Loaded only into the server's layout (assembly/layout.ts imports it as sverlin/layered), never
 * into the page. It lays out layered structures (findStructure); the design offers the form for no
 * other, and any other drawn layered falls back to its natural form.
 */

import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';

import { registerEngine, type EngineInput } from './engines';
import { formCentres } from './forms';

type Point = { x: number; y: number };

/**
 * dagre copies its graph's plain labels with structuredClone, which the server's isolate lacks (it
 * has no host APIs); its labels hold numbers and strings only, so a JSON copy is the same.
 */
function withStructuredClone() {
  const global = globalThis as { structuredClone?: (value: unknown) => unknown };
  global.structuredClone ??= (value) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function layeredCentres({
  structure,
  sizeOf,
  links,
  apart,
  flow,
  direction
}: EngineInput): Map<number, Point> {
  const runs = flow ?? (direction === 'right' ? 'x' : 'y');
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: runs === 'x' ? 'LR' : 'TB',
    // Layers lie room for an arrow and its label apart; dagre adds an edge label's own size to the
    // gap between layers, so its room here is an arrow's, the label's coming from the edge.
    ranksep: apart,
    nodesep: apart,
    edgesep: apart / 2
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const inStructure = new Set(structure.nodes);
  for (const node of structure.nodes) graph.setNode(String(node), { ...sizeOf(node) });
  // Edges run as the structure reads them, parent to child, so dagre ranks them its way: a tree's
  // children under it, a layered graph's nodes below their parents, an undirected graph's by
  // distance from its start, a link within one layer kept in it.
  const depth =
    structure.kind === 'layers' && structure.depths ? structure.depths : new Map<number, number>();
  const edges: { from: number; to: number }[] =
    structure.kind === 'tree'
      ? [...structure.children].flatMap(([from, children]) => children.map((to) => ({ from, to })))
      : structure.kind === 'layers'
        ? [...structure.parents].flatMap(([to, parents]) => parents.map((from) => ({ from, to })))
        : [];
  const labelOf = (from: number, to: number) =>
    links.find(
      ({ source, target }) =>
        (source === from && target === to) || (source === to && target === from)
    )?.label;
  for (const [index, { from, to }] of edges.entries()) {
    if (!inStructure.has(from) || !inStructure.has(to)) continue;
    const label = labelOf(from, to);
    // A link within one layer, as an undirected graph's between nodes at one distance, lies along
    // the layer and does not rank it; dagre takes no edge of length 0 (dijkstra-fields failed).
    if (depth.size && depth.get(to) === depth.get(from)) continue;
    const level = (depth.get(to) ?? 1) - (depth.get(from) ?? 0);
    graph.setEdge(
      String(from),
      String(to),
      {
        minlen: depth.size ? Math.max(1, level) : 1,
        ...(label ? { width: label.width, height: label.height, labelpos: 'c' } : {})
      },
      String(index)
    );
  }
  withStructuredClone();
  dagreLayout(graph);
  return new Map(
    structure.nodes.map((node) => {
      const { x, y } = graph.node(String(node)) as { x: number; y: number };
      return [node, { x, y }];
    })
  );
}

registerEngine('layered', (input) =>
  input.structure.kind === 'layers'
    ? layeredCentres(input)
    : formCentres('natural', input.structure, input.sizeOf, input)
);
