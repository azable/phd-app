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
import type { Direction, Form } from './forms';
import { headTrim } from './heads';
import type { LineStyle } from './LinkLines.svelte';
import { labelsIn, markerLook } from './markers';
import type { Spacing } from './props';
import { reachDrawn } from './route';
import { closest, contains, descendants, hasClass, type Reader } from './reader';
import type { SpanInput } from './span';
import { seenParts, unionOf } from './visible';

/** A free layout's props, which its element also carries for a step laid out on the model. */
export type ArrangementProps = {
  flow?: 'x' | 'y';
  /** The form the linked structure takes; unset, its natural one. */
  form?: Form;
  /** The way it runs where no flow sets it (see formCentres). */
  direction?: Direction;
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
  /** Children placed under the element their variable reaches (see ArrangementInput). */
  followers: readonly E[];
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
  /** The children drawing a variable whose link reaches an element, placed under it each step. */
  followers: E[];
  labels: Map<string, E>;
  styles: Record<string, LineStyle>;
  anchors: Record<string, Anchor>;
  parts: Anchor[];
  /** What each child draws at this step, as its parts not hidden and the boxes painted round them. */
  visible: Anchor[];
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
  const { flow, form, direction, curve, layoutSeed, gap, scope } = props;
  // The seed this arrangement draws every choice from: its kind's, mixed with its place, so two
  // arrangements of one kind differ, and each stays the same while the variant keeps that seed.
  const drawSeed = layoutSeedFor(layoutSeed ?? 1, scope);
  const attribute = (element: E, name: string) => read.attribute(element, name);
  const isMarker = (element: E) => attribute(element, 'data-sv-link') !== undefined;
  const hoisted = (element: E) => attribute(element, 'data-sv-hoist') !== undefined;
  // Link components sit among the children as hidden markers: they are links, not boxes. One a
  // view of an element draws from that element, with no from, is laid out here, from inside it.
  // A child drawing a variable whose link reaches an element (see Link.svelte's data-sv-reach), as
  // <Node kind="Var">{cur}</Node>, follows what it reaches: it is not placed by the layout, which
  // could put it near one element only, but under the element its variable reaches at each step,
  // as a pointer's label is (see followersOf in model/scene-of.ts).
  const followers = read
    .children(host)
    .filter(
      (child) =>
        !isMarker(child) &&
        [...descendants(read, child)].some(
          (inner) => isMarker(inner) && attribute(inner, 'data-sv-reach') === 'true'
        )
    );
  const following = (element: E) => followers.some((follower) => contains(read, follower, element));
  const markers = [
    ...read.children(host).filter(isMarker),
    ...[...descendants(read, host)].filter(
      (marker) =>
        isMarker(marker) &&
        hoisted(marker) &&
        read.parent(marker) !== host &&
        !following(marker) &&
        closest(read, marker, (at) => hasClass(read, at, 'placed')) === host
    )
  ];
  const elements = read
    .children(host)
    .filter(
      (child) =>
        !isMarker(child) &&
        attribute(child, 'data-sv-link-label') === undefined &&
        !followers.includes(child)
    );
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
  const visible: Anchor[] = [];
  // Where no node draws an element itself, but only its fields, the node holding its whole {#each}
  // item stands for it, so a link given its position still meets it.
  const items: Record<string, Anchor> = {};
  // The kinds of child whose fields link onward at this step: one of them drawing an end in its
  // field instead, as a list's last node, is still met at its value cell, as the others are.
  const linking = new Set(
    elements.flatMap((element) =>
      [...descendants(read, element)].some((inner) => isMarker(inner) && hoisted(inner))
        ? [attribute(element, 'data-sv-kind')]
        : []
    )
  );
  elements.forEach((element, box) => {
    const inside = [...descendants(read, element)];
    const anchor = (inner: E): Anchor => ({ box, ...read.boxIn(inner, element) });
    // What is seen of a node (see seenParts). Where that is boxes inside it, an arrow crossing the
    // node's other content to reach them stops at the nearest box around them it draws, else the child.
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
        ...(outer
          ? { frame: { x: outer.x, y: outer.y, width: outer.width, height: outer.height } }
          : {})
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
    const fields =
      inside.some((inner) => isMarker(inner) && hoisted(inner)) ||
      linking.has(attribute(element, 'data-sv-kind'));
    const nodes = inside.filter((inner) => attribute(inner, 'data-sv-node') !== undefined);
    const cells = nodes.filter((inner) =>
      read.children(inner).some((child) => hasClass(read, child, 'value'))
    );
    const slot = attribute(element, 'data-sv-slot');
    if (slot && fields && cells.length === 1) anchors[slot] = anchor(cells[0]);
    // The content inside a child, which arrows bend round: its innermost nodes.
    for (const inner of nodes)
      if (!read.children(inner).some((child) => hasNode(read, child))) parts.push(anchor(inner));
    // What it draws at this step, which arrows reach: that content where it is not hidden, and the
    // boxes painted around it, as a pointer's fill round the vertex it is at.
    const paints = (node: E) =>
      ['data-sv-fill', 'data-sv-stroke'].some((name) => {
        const value = attribute(node, name);
        return value !== undefined && value !== 'none';
      });
    for (const inner of [element, ...nodes])
      if (
        attribute(inner, 'data-sv-hidden') !== 'true' &&
        (paints(inner) || !read.children(inner).some((child) => hasNode(read, child)))
      )
        visible.push(anchor(inner));
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
  // A child a follower reaches at this step keeps room under the element for it, the layout's gap
  // below the element; each child keeping its largest size over the steps (see solveSpan), every
  // child a follower ever reaches keeps that room at every step, so nothing moves as it comes and
  // goes, as a pointer's label keeps its slot.
  for (const follower of followers) {
    const marker = [...descendants(read, follower)].find(
      (inner) => isMarker(inner) && attribute(inner, 'data-sv-reach') === 'true'
    );
    const reached = marker && anchors[attribute(marker, 'data-to') ?? ''];
    if (!reached) continue;
    const { width, height } = read.size(follower);
    const box = boxes[reached.box];
    box.height = Math.max(box.height, read.size(elements[reached.box]).height + space + height + 1);
    box.width = Math.max(box.width, width + 1);
  }
  const options = { links: specs, flow, form, direction, curve, gap: space };
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
    followers,
    labels,
    styles,
    anchors,
    parts,
    visible
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
  const { input, elements, followers, labels, styles, anchors, parts, visible } = arrangementInput(
    read,
    host,
    props
  );
  const { boxes, options, seed } = input;
  // Links this step draws, by their components' ids.
  const specs = new Map(
    (options.links ?? []).flatMap((link) => {
      const spec = linkSpecOf(link);
      return spec?.id ? [[spec.id, spec] as const] : [];
    })
  );
  const drawn = (edge: ArrangeEdge) => edge.id !== undefined && specs.has(edge.id);
  // Each arrow drawn reaches what its ends' nodes draw at this step (see reachDrawn).
  const reaching = (
    edges: readonly ArrangeEdge[],
    placements: readonly { x: number; y: number }[]
  ) =>
    edges.filter(drawn).map((edge) => {
      const spec = specs.get(edge.id as string) as LinkSpec;
      const drawnAt = (key: string) => {
        const anchor = anchors[key];
        if (!anchor) return [];
        const { x, y } = placements[anchor.box];
        // A box drawn round the element, as a pointer's fill at some steps, is crossed to meet the
        // element, so the arrow keeps its place from step to step.
        const around = (part: Anchor) =>
          part.x <= anchor.x &&
          part.y <= anchor.y &&
          part.x + part.width >= anchor.x + anchor.width &&
          part.y + part.height >= anchor.y + anchor.height;
        const parts = visible.filter((part) => part.box === anchor.box && !around(part));
        return [anchor, ...parts].map((box) => ({
          left: x + box.x,
          top: y + box.y,
          right: x + box.x + box.width,
          bottom: y + box.y + box.height
        }));
      };
      const trim = headTrim(edge.head?.shape, edge.head?.size ?? 0);
      const reached = reachDrawn(
        edge.path,
        { start: drawnAt(spec.start ?? spec.from), end: drawnAt(spec.to) },
        { start: edge.heads.start ? trim : 0, end: edge.heads.end ? trim : 0 }
      );
      return reached
        ? {
            ...edge,
            path: reached.path,
            x1: reached.start.x,
            y1: reached.start.y,
            x2: reached.end.x,
            y2: reached.end.y
          }
        : edge;
    });
  // Children go where the solution over every step put them, and only this step's links are
  // drawn. A child the solution does not know, such as before it is made, is laid out here alone.
  const span = memory?.scopes.get(props.scope)?.span;
  if (span && boxes.every(({ key }) => span.positions[key])) {
    const placements = boxes.map(({ key }) => span.positions[key]);
    return {
      elements,
      followers,
      placements,
      width: span.width,
      height: span.height,
      edges: memory?.routes?.get(props.scope)?.get(memory.step) ?? reaching(span.edges, placements),
      choices: span.choices,
      styles,
      labels,
      problems: []
    };
  }
  const solved = arrangeOnce(seed, boxes, { ...options, anchors, parts });
  return {
    elements,
    followers,
    placements: solved.placements,
    width: solved.width,
    height: solved.height,
    edges: reaching(solved.edges, solved.placements),
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
