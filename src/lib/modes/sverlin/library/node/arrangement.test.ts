import { describe, expect, it } from 'vitest';

import { arrangeChildren } from './arrangement';
import type { Reader } from './reader';

/** An element of a fake page: its attributes, its children and its box in the host. */
type Fake = {
  attributes: Record<string, string>;
  children: Fake[];
  parent?: Fake;
  x: number;
  y: number;
  width: number;
  height: number;
};

const fake = (
  attributes: Record<string, string>,
  box: { x: number; y: number; width: number; height: number },
  children: Fake[] = []
): Fake => {
  const element: Fake = { attributes, children, ...box };
  for (const child of children) child.parent = element;
  return element;
};

const reader: Reader<Fake> = {
  attribute: (element, name) => element.attributes[name],
  children: (element) => element.children,
  parent: (element) => element.parent,
  boxIn: (inner, outer) => ({
    x: inner.x - outer.x,
    y: inner.y - outer.y,
    width: inner.width,
    height: inner.height
  }),
  size: ({ width, height }) => ({ width, height }),
  fontSize: () => 16
};

/**
 * A vertex as a breadth-first search draws it: a name cell over a caption, and a pointer's label
 * under them that keeps its room, hidden, at the steps the pointer is elsewhere.
 */
const vertex = (index: number, labelled: boolean, filled = false): Fake => {
  const node = (id: string, y: number, height: number, extra: Record<string, string> = {}) =>
    fake({ 'data-sv-node': `${id}${index}`, ...extra }, { x: 0, y, width: 80, height });
  const label = node('label', 100, 24, labelled ? {} : { 'data-sv-hidden': 'true' });
  return fake(
    { 'data-sv-node': `v${index}`, 'data-sv-slot': `v[${index}]` },
    { x: 0, y: 0, width: 80, height: 130 },
    [
      fake(
        { 'data-sv-node': `column${index}`, ...(filled ? { 'data-sv-fill': 'yellow' } : {}) },
        { x: 0, y: 0, width: 80, height: 130 },
        [
          node('name', 0, 50, { 'data-sv-framed': 'true', 'data-sv-fill': 'white' }),
          node('caption', 50, 24),
          label
        ]
      )
    ]
  );
};

const link = (from: number, to: number) =>
  fake(
    { 'data-sv-link': `${from}-${to}`, 'data-from': `v[${from}]`, 'data-to': `v[${to}]` },
    { x: 0, y: 0, width: 0, height: 0 }
  );

const arrowsFrom = (labelled: boolean, filled = false) => {
  const host = fake({}, { x: 0, y: 0, width: 0, height: 0 }, [
    vertex(0, labelled, filled),
    vertex(1, false),
    vertex(2, false),
    link(0, 1),
    link(0, 2)
  ]);
  const { edges } = arrangeChildren(
    reader,
    host,
    { form: 'natural', direction: 'down', curve: 'straight', gap: 0.5, scope: 'graph' },
    undefined
  );
  return edges;
};

describe('a free layout’s arrows', () => {
  it('leave a vertex below what it draws at the step, not the room kept for a hidden label', () => {
    for (const edge of arrowsFrom(false)) expect(edge.y1).toBeCloseTo(74, 5);
    for (const edge of arrowsFrom(true)) expect(edge.y1).toBeCloseTo(124, 5);
  });

  it('keep their place where a pointer paints a box round the vertex', () => {
    for (const edge of arrowsFrom(false, true)) expect(edge.y1).toBeCloseTo(74, 5);
  });
});
