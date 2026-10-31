/**
 * What a free layout reads of its children, and where it puts them (see Arranged.svelte): the same
 * whether the children are mounted, or a step's markup laid out on the layout model (see
 * model/drawn.ts), through a reader of either.
 */

import type { LayoutMemory } from '../type-context';
import {
  arrangeOnce,
  layoutSeedFor,
  linkSpecOf,
  type Anchor,
  type ArrangeBox,
  type ArrangeEdge,
  type LayoutChoices,
  type LinkSpec
} from './arrange';
import type { Form } from './forms';
import type { LineStyle } from './LinkLines.svelte';
import { labelsIn, markerLook } from './markers';
import type { Spacing } from './props';
import { closest, contains, descendants, hasClass, type Reader } from './reader';
import type { SpanInput } from './span';
import { seenParts, unionOf } from './visible';

/** A free layout's props, which its element also carries for a step laid out on the model. */
export type ArrangementProps = {
  flow?: 'x' | 'y';
  /** The form the linked structure takes; unset, or one it cannot take, its natural one. */
  form?: Form;
  curve?: 'straight' | 'curved';
  /** The seed of its kind's layout, the variant's; unset, 1. */
  layoutSeed?: number;
  gap: Spacing;
  /** Keys this arrangement's random starts, such as the node's id. */
  scope: string;
};

/** A free layout laid out: where its children go, its size, and the links and labels it draws. */
export type Arrangement<E> = {
  elements: readonly E[];
  placements: readonly { x: number; y: number }[];
  width: number;
  height: number;
  edges: ArrangeEdge[];
  choices: LayoutChoices;
  styles: Record<string, LineStyle>;
  labels: Map<string, E>;
  problems: readonly string[];
};

/** What a free layout contains at a step, read from its host (the element holding its children). */
export type ArrangementInput<E> = {
  input: SpanInput;
  elements: E[];
  labels: Map<string, E>;
  styles: Record<string, LineStyle>;
  anchors: Record<string, Anchor>;
  parts: Anchor[];
};

/**
 * Read what a free layout contains: each child measured as laid out inside, by its key, the boxes
 * inside it that links meet and bend round, and its links.
 */
export function arrangementInput<E>(
  read: Reader<E>,
  host: E,
  props: ArrangementProps
): ArrangementInput<E> {
  const { flow, form, curve, layoutSeed, gap, scope } = props;
  // The seed this arrangement draws every choice from: its kind's, mixed with its place, so two
  // arrangements of one kind differ, and each stays the same while the variant keeps that seed.
  const drawSeed = layoutSeedFor(layoutSeed ?? 1, scope);
  const attribute = (element: E, name: string) => read.attribute(element, name);
  const isMarker = (element: E) => attribute(element, 'data-sv-link') !== undefined;
  const hoisted = (element: E) => attribute(element, 'data-sv-hoist') !== undefined;
  // Link components sit among the children as hidden markers: they are links, not boxes. One a
  // view of an element draws from that element, with no from, is laid out here, from inside it.
  const markers = [
    ...read.children(host).filter(isMarker),
    ...[...descendants(read, host)].filter(
      (marker) =>
        isMarker(marker) &&
        hoisted(marker) &&
        read.parent(marker) !== host &&
        closest(read, marker, (at) => hasClass(read, at, 'placed')) === host
    )
  ];
  const elements = read
    .children(host)
    .filter((child) => !isMarker(child) && attribute(child, 'data-sv-link-label') === undefined);
  // Each link's label, measured so the link leaves room for it, then placed on its middle or near it.
  const labels = labelsIn(read, host);
  // A link with no from starts at the node it sits in, as a node's next field, not its whole box.
  const origin = (marker: E) => {
    const link = attribute(marker, 'data-sv-link');
    return hoisted(marker) && link ? `${attribute(marker, 'data-from') ?? ''}↦${link}` : undefined;
  };
  const looks = markers.map((marker) => markerLook((name) => attribute(marker, name)));
  const specs: LinkSpec[] = markers.map((marker, index) => {
    const id = attribute(marker, 'data-sv-link');
    const label = labels.get(id ?? '');
    const { route, head } = looks[index];
    const start = origin(marker);
    return {
      from: attribute(marker, 'data-from') ?? '',
      to: attribute(marker, 'data-to') ?? '',
      ...(start ? { start } : {}),
      directed: attribute(marker, 'data-directed') !== 'false',
      ...(id ? { id } : {}),
      ...(route ? { route } : {}),
      ...(head ? { head } : {}),
      ...(label ? { label: read.size(label) } : {})
    };
  });
  const styles: Record<string, LineStyle> = Object.fromEntries(
    markers.flatMap((marker, index) => {
      const id = attribute(marker, 'data-sv-link');
      return id ? [[id, looks[index].style]] : [];
    })
  );
  const space = gap * (read.fontSize(host) || 16);
  // Pointers' views are drawn around a child (data-sv-around), the one at it taking the pointer's
  // identity so it slides with the pointer in a row; here the child is still the element it is
  // drawn around, known by that element's identity.
  const identityOf = (element: E) => {
    const around = attribute(element, 'data-sv-around');
    if (around === undefined) return attribute(element, 'data-sv-identity');
    const inner = [...descendants(read, element)].find(
      (each) => attribute(each, 'data-sv-slot') === around
    );
    return (
      (inner && attribute(inner, 'data-sv-identity')) ?? attribute(element, 'data-sv-identity')
    );
  };
  const boxes: ArrangeBox[] = elements.map((element, index) => {
    // Layout sizes, unaffected by the frame's scale; whole pixels round, so a pixel more keeps a
    // fractional width from wrapping once placed.
    const { width, height } = read.size(element);
    return {
      // A child is known by the value it draws, as a node of a heap, which keeps its place as
      // others come and go, or else by its node id, the same at every step.
      key: identityOf(element) ?? attribute(element, 'data-sv-node') ?? `#${index}`,
      width: width + 1,
      height: height + 1
    };
  });
  // Links attach to the node drawing the element they name.
  const anchors: Record<string, Anchor> = {};
  const parts: Anchor[] = [];
  // Where no node draws an element itself, but only its fields, the node holding its whole {#each}
  // item stands for it, so a link given its position still meets it.
  const items: Record<string, Anchor> = {};
  elements.forEach((element, box) => {
    const inside = [...descendants(read, element)];
    const anchor = (inner: E): Anchor => ({ box, ...read.boxIn(inner, element) });
    // What is seen of a node (see seenParts). Where that is boxes inside it, an arrow crossing the
    // node's other content to reach them stops at the nearest box around them it draws, if any.
    const seen = (node: E): Anchor => {
      const shown = seenParts(read, node);
      if (shown[0] === node) return anchor(node);
      const { left, top, right, bottom } = unionOf(
        shown.map((inner) => {
          const { x, y, width, height } = anchor(inner);
          return { left: x, top: y, right: x + width, bottom: y + height };
        })
      );
      const around = closest(read, read.parent(shown[0]), (at) =>
        Boolean(attribute(at, 'data-sv-framed'))
      );
      const outer =
        around &&
        contains(read, element, around) &&
        shown.every((inner) => contains(read, around, inner))
          ? anchor(around)
          : undefined;
      return {
        box,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        frame: outer ? { x: outer.x, y: outer.y, width: outer.width, height: outer.height } : null
      };
    };
    // A node drawing an element of the state is also found by it, as vertices[2], the outermost
    // such node first, so a link given a position meets the element's whole view, as it is seen.
    for (const inner of [element, ...inside]) {
      const slot = attribute(inner, 'data-sv-slot');
      if (slot && !(slot in anchors)) anchors[slot] = seen(inner);
      const item = attribute(inner, 'data-sv-item');
      if (item && !(item in items)) items[item] = seen(inner);
    }
    // A child drawing a node whose fields link onward, as [ A | next ], is met at its one value
    // cell, never the field an arrow leaves.
    const fields = inside.some((inner) => isMarker(inner) && hoisted(inner));
    const nodes = inside.filter((inner) => attribute(inner, 'data-sv-node') !== undefined);
    const cells = nodes.filter((inner) =>
      read.children(inner).some((child) => hasClass(read, child, 'value'))
    );
    const slot = attribute(element, 'data-sv-slot');
    if (slot && fields && cells.length === 1) anchors[slot] = anchor(cells[0]);
    // The content inside a child, which arrows bend round: its innermost nodes.
    for (const inner of nodes)
      if (!read.children(inner).some((child) => hasNode(read, child))) parts.push(anchor(inner));
    // A link from inside the child starts at the node holding it.
    for (const marker of markers) {
      const key = origin(marker);
      const field = closest(
        read,
        read.parent(marker),
        (at) => attribute(at, 'data-sv-node') !== undefined
      );
      if (key && field && contains(read, element, field)) anchors[key] = anchor(field);
    }
  });
  for (const [slot, item] of Object.entries(items)) if (!(slot in anchors)) anchors[slot] = item;
  const options = { links: specs, flow, form, curve, gap: space };
  const keyed = (anchor: Anchor) => ({ ...anchor, box: boxes[anchor.box].key });
  return {
    input: {
      seed: drawSeed,
      boxes,
      anchors: Object.fromEntries(Object.entries(anchors).map(([key, a]) => [key, keyed(a)])),
      parts: parts.map(keyed),
      options
    },
    elements,
    labels,
    styles,
    anchors,
    parts
  };
}

/**
 * Lay out a free layout's children, read from its host: place them where the solution over every
 * step put them (see model/reserve.ts), or, for a step it does not know, by solving this step
 * alone.
 */
export function arrangeChildren<E>(
  read: Reader<E>,
  host: E,
  props: ArrangementProps,
  memory: LayoutMemory | undefined
): Arrangement<E> {
  const { input, elements, labels, styles, anchors, parts } = arrangementInput(read, host, props);
  const { boxes, options, seed } = input;
  // Links this step draws, by their components' ids.
  const present = new Set(options.links?.map((link) => linkSpecOf(link)?.id));
  const drawn = (edge: ArrangeEdge) => edge.id !== undefined && present.has(edge.id);
  // Children go where the solution over every step put them, and only this step's links are
  // drawn. A child the solution does not know, such as before it is made, is laid out here alone.
  const span = memory?.scopes.get(props.scope)?.span;
  if (span && boxes.every(({ key }) => span.positions[key]))
    return {
      elements,
      placements: boxes.map(({ key }) => span.positions[key]),
      width: span.width,
      height: span.height,
      edges: span.edges.filter(drawn),
      choices: span.choices,
      styles,
      labels,
      problems: []
    };
  const solved = arrangeOnce(seed, boxes, { ...options, anchors, parts });
  return {
    elements,
    placements: solved.placements,
    width: solved.width,
    height: solved.height,
    edges: solved.edges.filter(drawn),
    choices: solved.choices,
    styles,
    labels,
    problems: solved.problems
  };
}

/** Whether an element is a node or holds one. */
function hasNode<E>(read: Reader<E>, element: E): boolean {
  return (
    read.attribute(element, 'data-sv-node') !== undefined ||
    read.children(element).some((child) => hasNode(read, child))
  );
}
