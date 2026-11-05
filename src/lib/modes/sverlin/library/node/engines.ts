/**
 * Layout engines: what places a free layout's linked structure. Each takes the structure its links
 * make (see findStructure), every node's fixed size, and the room links and their labels need, and
 * gives each node's centre; the general layout (arrange.ts) then settles the nodes outside the
 * structure round it and routes the links. An engine is a design value of the layout's kind
 * (`Graph.engine`), so arrangements and comparisons can vary it as they vary its form.
 *
 * - `forms`: the app's own, a structure's natural shape (a tree, layers, a ring, a line) or a
 *   sequence form (snake, wave, arc, scatter), its seed choosing a layer's order (see forms.ts).
 * - `layered`: dagre (https://github.com/dagrejs/dagre), the Sugiyama framework of Gansner et
 *   al.'s dot: ranks by network simplex, crossings reduced layer by layer, coordinates by Brandes
 *   and Köpf, every node at its own size, so nodes of one layer pack by their own widths. It lays
 *   out trees and layered graphs; other structures, and forms other than natural, stay with forms.
 */

import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';

import { formCentres, type Direction, type Form, type Structure } from './forms';

export const engines = ['forms', 'layered'] as const;
export type Engine = (typeof engines)[number];

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** What an engine is given: the structure, each node's size, and the room between them. */
export type EngineInput = {
  structure: Structure;
  sizeOf: (node: number) => Size;
  /** Each link of the structure's, its label's size where it has one. */
  links: readonly { source: number; target: number; label?: Size }[];
  form: Form;
  /** Between linked nodes: an arrow's room, and its label's where links have labels. */
  room: number;
  /** Between nodes no link joins, side by side in a layer. */
  apart: number;
  random: (key: string) => number;
  flow?: 'x' | 'y';
  direction?: Direction;
};

/** Each node's centre, by its number, in pixels; any origin, as the caller centres them. */
export function engineCentres(engine: Engine | undefined, input: EngineInput): Map<number, Point> {
  if (engine === 'layered' && layeredFits(input)) return layeredCentres(input);
  return formCentres(input.form, input.structure, input.sizeOf, input);
}

/** Whether the layered engine lays this structure out: a tree or layers, in the natural form. */
function layeredFits({ structure, form }: EngineInput): boolean {
  return form === 'natural' && (structure.kind === 'tree' || structure.kind === 'layers');
}

function layeredCentres({
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
    const level = (depth.get(to) ?? 1) - (depth.get(from) ?? 0);
    graph.setEdge(
      String(from),
      String(to),
      {
        minlen: depth.size ? Math.max(0, level) : 1,
        ...(label ? { width: label.width, height: label.height, labelpos: 'c' } : {})
      },
      String(index)
    );
  }
  dagreLayout(graph);
  return new Map(
    structure.nodes.map((node) => {
      const { x, y } = graph.node(String(node)) as { x: number; y: number };
      return [node, { x, y }];
    })
  );
}
