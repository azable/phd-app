/**
 * Free layout of a node's children with WebCola, over their measured boxes: links pull the boxes
 * they join to a length that leaves room for the arrow, and overlap removal keeps every box clear
 * of the others. Free layouts start from their kind's layout seed, a variable of the design, and the
 * same seed always gives the same one. Rows and columns are CSS (see Node.svelte).
 */

import { Layout } from 'webcola/dist/src/layout';

import {
  findStructure,
  formCentres,
  formsFor,
  naturalForm,
  sequenceForms,
  type Form
} from './forms';
import { headTrim, type HeadEnds } from './heads';
import { curvePath, routeCurve, wirePath, type Box } from './route';
import { routeWires } from './wires';

/** One child to place: its key and its size in pixels. */
export type ArrangeBox = { key: string; width: number; height: number };

/** A child's top-left corner, relative to the arrangement's top-left. */
export type Placement = { key: string; x: number; y: number };

/**
 * A link from one child's edge to another's, drawn as a curve or a wire (an SVG path), stopped short
 * of the ends its heads are drawn at; x1, y1 and x2, y2 are where the path leaves and arrives.
 */
export type ArrangeEdge = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  path: string;
  directed: boolean;
  /** The ends its heads are drawn at, and their shape and size. */
  heads: HeadEnds;
  head?: LinkHead;
  /** The link this edge draws, as written, such as 'a -> b'. */
  link: string;
  /** The id of the link component it draws, if it came from one. */
  id?: string;
  /** The middle of the curve, or of a wire's longest run, where a label goes. */
  middle: { x: number; y: number };
};

export type ArrangeResult = {
  placements: Placement[];
  edges: ArrangeEdge[];
  /** The size that hugs every child. */
  width: number;
  height: number;
  /** Links that were ignored, with why. */
  problems: string[];
  /** What the seed chose for this arrangement, to report and to pin. */
  choices: LayoutChoices;
};

/** The choices an arrangement drew: the form of its linked structure, if any, and how arrows curve. */
export type LayoutChoices = { form?: Form; curve?: 'straight' | 'curved' };

export type Point = { x: number; y: number };

export type ArrangeOptions = {
  /** Links such as 'a -> b' (directed) or 'a - b', or link components' specs. */
  links?: readonly (string | LinkSpec)[];
  /** The axis directed links point along in a free arrangement: 'x' or 'y'. */
  flow?: 'x' | 'y';
  /** The space between children, in pixels. */
  gap: number;
  /** A random number in [0, 1) for a key, or undefined to start every child at the centre. */
  random?: (key: string) => number;
  /** The form the linked structure takes, if it can; unset, or one it cannot take, its natural one. */
  form?: Form;
  /** Keys (see linkKey) of the links present at every step; only these decide the structure. Unset, all do. */
  permanent?: ReadonlySet<string>;
  /** Whether arrows prefer to run straight or to curve; unset, the seed draws it. */
  curve?: 'straight' | 'curved';
  /** The width to height of the space the arrangement has, which shapes fill. */
  aspect?: number;
  /** Content inside children, such as labels beside a value, which arrows bend round. */
  parts?: readonly Anchor[];
  /**
   * Where links attach, by key, when not to a whole child: a node inside a child, such as the
   * value cell of a column that also holds labels.
   */
  anchors?: Readonly<Record<string, Anchor>>;
};

/** A link's head: its shape (see heads.ts) and its size in pixels. */
export type LinkHead = { shape: string; size: number };

/**
 * A link from a <Link> component: its ends by key, whether it points one way, its id, its own
 * route, if any, its head, and its label's size, which the link leaves room for.
 */
export type LinkSpec = {
  from: string;
  to: string;
  directed: boolean;
  id?: string;
  route?: 'straight' | 'curved' | 'wire';
  head?: LinkHead;
  label?: { width: number; height: number };
  /**
   * The anchor it starts at inside its from child, as a node's next field: it leaves that field
   * itself, arcing over its node, rather than the child's edge.
   */
  start?: string;
};

/** A link as a spec, whether written as text such as "a -> b" or given as one; undefined if unreadable. */
export function linkSpecOf(link: string | LinkSpec): LinkSpec | undefined {
  if (typeof link !== 'string') return link;
  const match = /^\s*(\S+)\s*(->|-)\s*(\S+)\s*$/u.exec(link);
  return match ? { from: match[1], to: match[3], directed: match[2] === '->' } : undefined;
}

const linkText = ({ from, to, directed }: LinkSpec) => `${from} ${directed ? '->' : '-'} ${to}`;

/** What identifies a link across steps: its id, or else its ends and direction. */
export function linkKey(link: string | LinkSpec): string | undefined {
  const spec = linkSpecOf(link);
  return spec && (spec.id ?? linkText(spec));
}

/**
 * A layout run on to convergence for at most a bound of solver steps: some layouts never converge,
 * with constraints and stress pulling against each other, and would otherwise never return.
 */
class BoundedLayout extends Layout {
  settle(steps: number): void {
    for (let step = 0; step < steps && !this.tick(); step++);
  }
}

/**
 * A box a link attaches to: inside child `box`, relative to that child's top-left. `frame` is the box
 * around it where an arrow crossing the child's other content stops instead: unset, the whole child;
 * null, none, as for what is seen of a node that draws no box of its own (see visible.ts).
 */
export type Anchor = {
  box: number;
  x: number;
  y: number;
  width: number;
  height: number;
  frame?: { x: number; y: number; width: number; height: number } | null;
};

// The least room left for an arrow between the boxes it joins, so it is always visible.
const arrowRoom = 28;

// The area starting positions are spread over; only its proportions matter.
const startArea = { width: 800, height: 500 };

type Separation = { axis: 'x' | 'y'; left: number; right: number; gap: number; equality?: true };
type Alignment = {
  type: 'alignment';
  axis: 'x' | 'y';
  offsets: { node: number; offset: number }[];
};

export function arrange(boxes: readonly ArrangeBox[], options: ArrangeOptions): ArrangeResult {
  const problems: string[] = [];
  const index = new Map(boxes.map((box, position) => [box.key, position]));
  const at = (key: string, source: string) => {
    const position = index.get(key);
    if (position === undefined) problems.push(`"${source}" names no node with key "${key}".`);
    return position;
  };
  // A link's end: a keyed anchor inside a child, or a whole keyed child.
  const anchorOf = (key: string, source: string): Anchor | undefined => {
    const anchor = options.anchors?.[key];
    if (anchor) return anchor;
    const box = at(key, source);
    return box === undefined
      ? undefined
      : { box, x: 0, y: 0, width: boxes[box].width, height: boxes[box].height };
  };
  // How far an anchor's centre lies from its child's centre along an axis.
  const offsetOf = (anchor: Anchor, axis: 'x' | 'y') =>
    axis === 'x'
      ? anchor.x + anchor.width / 2 - boxes[anchor.box].width / 2
      : anchor.y + anchor.height / 2 - boxes[anchor.box].height / 2;

  const links = (options.links ?? []).flatMap((link) => {
    const spec = linkSpecOf(link);
    if (!spec) {
      problems.push(`"${link as string}" is not a link such as "a -> b".`);
      return [];
    }
    const text = linkText(spec);
    const from = anchorOf(spec.start ?? spec.from, text);
    const to = anchorOf(spec.to, text);
    return !from || !to || from.box === to.box
      ? []
      : [
          {
            source: from.box,
            target: to.box,
            from,
            to,
            directed: spec.directed,
            text,
            id: spec.id,
            key: spec.id ?? text,
            route: spec.route,
            head: spec.head,
            label: spec.label,
            field: spec.start !== undefined
          }
        ];
  });

  // Each link's length comes from its own two boxes: half of each plus room for the arrow and its
  // label. With a flow, a directed link's target sits that far along the flow axis, so arrows run
  // along it. A form spaces every link alike, with room for the largest label.
  const flowExtent = options.flow === 'y' ? 'height' : 'width';
  const labelRoom = ({ label }: { label?: { width: number; height: number } }) =>
    label ? Math.max(label.width, label.height) : 0;
  const room = Math.max(3 * options.gap, arrowRoom) + Math.max(0, ...links.map(labelRoom));
  const laidLinks = links.map((link) => {
    const { source, target, from, to, directed, id, key } = link;
    const own = Math.max(3 * options.gap, arrowRoom) + labelRoom(link);
    const along = (from[flowExtent] + to[flowExtent]) / 2 + own;
    const ideal = options.flow
      ? along
      : (Math.max(from.width, from.height) + Math.max(to.width, to.height)) / 2 + own;
    return { source, target, from, to, ideal, along, directed, id, key };
  });
  const solvedLinks: { source: number; target: number; ideal: number }[] = [...laidLinks];

  // The links of a free arrangement are read for the structure they make, such as a path, a tree,
  // or a layered graph, from links present at every step only, so a link that comes and goes is
  // drawn but does not change it. The structure takes its kind's form where it can, else its natural
  // one, so the same values draw the same form whatever the space.
  // A node's links are read in the order they leave it, by where they start inside it, so a tree's
  // left field leads to the child placed left of its right field's.
  const leaving = (link: (typeof laidLinks)[number]) =>
    offsetOf(link.from, 'x') * 1e6 + offsetOf(link.from, 'y');
  const firstFrom = new Map<number, number>();
  laidLinks.forEach(({ source }, position) => {
    if (!firstFrom.has(source)) firstFrom.set(source, position);
  });
  const structure = findStructure(
    boxes.length,
    laidLinks
      .filter(({ key }) => !options.permanent || options.permanent.has(key))
      .sort(
        (a, b) =>
          (firstFrom.get(a.source) ?? 0) - (firstFrom.get(b.source) ?? 0) || leaving(a) - leaving(b)
      )
  );
  const aspect = options.aspect ?? 16 / 9;
  const along = options.flow === 'y' ? 'y' : 'x';
  const sizeOf = (node: number) => boxes[node];
  // Sequence forms lie along x; a vertical flow turns them, swapping each centre's axes.
  const placedIn = (form: Form) => {
    if (!structure) return undefined;
    const turned = along === 'y' && (sequenceForms as readonly Form[]).includes(form);
    const centres = formCentres(form, structure, sizeOf, {
      room,
      aspect: turned ? 1 / aspect : aspect,
      random: options.random ?? (() => 0.5)
    });
    return turned
      ? new Map([...centres].map(([node, { x, y }]) => [node, { x: y, y: x }]))
      : centres;
  };
  const form: Form | undefined = !structure
    ? undefined
    : options.form && formsFor(structure.kind, options.flow).includes(options.form)
      ? options.form
      : naturalForm(structure.kind, options.flow);
  const formed = form ? placedIn(form) : undefined;
  const inStructure = new Set(formed ? formed.keys() : []);

  // Along a flow, each directed link's target anchor sits at least a link's length further along
  // than its source anchor, so arrows run with the flow. A link that closes a cycle cannot point
  // forward too, so it is left free; and links forming a simple chain (one out, one in) are lined
  // up on their anchors, so a list runs straight.
  const flowing: (Separation | Alignment)[] = [];
  if (options.flow) {
    const axis = options.flow;
    const cross = axis === 'x' ? 'y' : 'x';
    const forward = laidLinks.filter(({ directed }, i) => directed && !closesCycle(laidLinks, i));
    const outs = new Map<number, number>();
    const ins = new Map<number, number>();
    for (const { source, target } of forward) {
      outs.set(source, (outs.get(source) ?? 0) + 1);
      ins.set(target, (ins.get(target) ?? 0) + 1);
    }
    for (const { source, target, from, to, along } of forward) {
      // A formed structure places its own links.
      if (inStructure.has(source) && inStructure.has(target)) continue;
      flowing.push({
        axis,
        left: source,
        right: target,
        gap: along + offsetOf(from, axis) - offsetOf(to, axis)
      });
      if (outs.get(source) === 1 && ins.get(target) === 1)
        flowing.push({
          type: 'alignment',
          axis: cross,
          offsets: [
            { node: source, offset: 0 },
            { node: target, offset: offsetOf(from, cross) - offsetOf(to, cross) }
          ]
        });
    }
  }

  // Children start where the seed puts them in the start area, round its middle.
  const middle = { x: startArea.width / 2, y: startArea.height / 2 };
  const nodes: { width: number; height: number; x?: number; y?: number; fixed?: number }[] =
    boxes.map((box) => ({
      // The gap is added to each box, so overlap removal keeps boxes that far apart.
      width: box.width + options.gap,
      height: box.height + options.gap,
      ...(options.random
        ? {
            x: options.random(`${box.key}.x`) * startArea.width,
            y: options.random(`${box.key}.y`) * startArea.height
          }
        : {})
    }));

  // A formed structure is placed outright, round the middle of the start area, and held there while
  // the rest settles round it. The form places each node's anchor, such as its value cell, so links
  // meet on the form even where labels make a box lopsided.
  if (formed) {
    const points = [...formed.values()];
    const meanX = points.reduce((sum, { x }) => sum + x, 0) / points.length;
    const meanY = points.reduce((sum, { y }) => sum + y, 0) / points.length;
    // A node is placed by where links meet it, its box or value cell, rather than a field one leaves.
    const anchorOfBox = (box: number) =>
      laidLinks.find(({ target }) => target === box)?.to ??
      laidLinks.find(({ source }) => source === box)?.from;
    for (const [node, point] of formed) {
      const anchor = anchorOfBox(node);
      nodes[node].x = startArea.width / 2 + point.x - meanX - (anchor ? offsetOf(anchor, 'x') : 0);
      nodes[node].y = startArea.height / 2 + point.y - meanY - (anchor ? offsetOf(anchor, 'y') : 0);
      nodes[node].fixed = 1;
    }
  }

  // Nothing pulls separate groups together (children joined by links count as one), so in a free
  // arrangement one child of each group is tied to an invisible hub: they gather round it
  // compactly, in an order that depends on where the seed starts them.
  const leaders = groupLeaders(boxes.length, solvedLinks);
  if (leaders.length > 1) {
    const hub = nodes.length;
    nodes.push({
      width: 0.01,
      height: 0.01,
      ...(options.random ? middle : {})
    });
    for (const member of leaders) {
      const { width, height } = boxes[member];
      solvedLinks.push({
        source: hub,
        target: member,
        // Half the side of a square of the same area: long, thin nodes such as a line of text are not
        // held as far out as their length, so the arrangement stays compact.
        ideal: Math.sqrt(width * height) / 2 + options.gap
      });
    }
  }

  if (boxes.length) {
    const layout = new BoundedLayout()
      .size([startArea.width, startArea.height])
      .nodes(nodes)
      .links(solvedLinks)
      .constraints(flowing)
      .avoidOverlaps(true)
      .handleDisconnected(false)
      .linkDistance((link) => (link as unknown as { ideal: number }).ideal);
    // Iterations without constraints, then with the flow's, then with overlap removal too; then on to
    // convergence, synchronously, so the same input always gives the same result.
    layout.start(20, 20, 20, 0, false, false);
    layout.settle(1000);
  }

  const centres = nodes.slice(0, boxes.length).map(({ x = 0, y = 0 }) => ({ x, y }));
  // Placements are relative to the top-left of everything placed.
  const left = Math.min(...boxes.map((box, i) => centres[i].x - box.width / 2));
  const top = Math.min(...boxes.map((box, i) => centres[i].y - box.height / 2));
  const placements = boxes.map((box, i) => ({
    key: box.key,
    x: centres[i].x - box.width / 2 - left,
    y: centres[i].y - box.height / 2 - top
  }));
  const width = Math.max(0, ...boxes.map((box, i) => placements[i].x + box.width));
  const height = Math.max(0, ...boxes.map((box, i) => placements[i].y + box.height));

  // Arrows are curves between anchors that bend round everything else: the other children, and the
  // labels inside their own two children. The seed sets how readily they curve, from straight
  // where nothing is in the way to an arc either side; scattered forms always curve.
  const boxAt = (anchor: Anchor): Box => {
    const { x, y } = placements[anchor.box];
    return {
      left: x + anchor.x,
      top: y + anchor.y,
      right: x + anchor.x + anchor.width,
      bottom: y + anchor.y + anchor.height
    };
  };
  const whole = (box: number): Anchor => ({ box, x: 0, y: 0, ...boxes[box] });
  const overlaps = (a: Box, b: Box) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  // Wires turn only at right angles, routed all together so their runs keep apart, between the
  // boxes they meet: a child, or a box inside it, as a vertex's name cell, they may run in to reach.
  const wired = links.filter(({ route }) => route === 'wire');
  const smaller = (anchor: Anchor) =>
    anchor.width < boxes[anchor.box].width - 1 || anchor.height < boxes[anchor.box].height - 1;
  const inner = boxes.map(() => [] as Anchor[]);
  for (const { from, to } of wired)
    for (const anchor of [from, to])
      if (
        smaller(anchor) &&
        !inner[anchor.box].some((each) => each.x === anchor.x && each.y === anchor.y)
      )
        inner[anchor.box].push(anchor);
  const wireEnd = (anchor: Anchor) => {
    const ends = inner[anchor.box];
    const end = ends.findIndex((each) => each.x === anchor.x && each.y === anchor.y);
    return { child: anchor.box, ...(ends.length ? { end: Math.max(0, end) } : {}) };
  };
  const wires = new Map(
    routeWires(
      boxes.map((_, box) => ({ box: boxAt(whole(box)), ends: inner[box].map(boxAt) })),
      wired.map(({ from, to }) => ({ from: wireEnd(from), to: wireEnd(to) }))
    ).map((corners, i) => [wired[i], corners])
  );
  // A label sits on its link's middle, and every other curve bends round it: curves are routed once
  // to find where the labels go, and again round them.
  const labelAt = (middle: { x: number; y: number }, label: { width: number; height: number }) => ({
    left: middle.x - label.width / 2,
    top: middle.y - label.height / 2,
    right: middle.x + label.width / 2,
    bottom: middle.y + label.height / 2
  });
  const routeAll = (labels: readonly (Box | undefined)[]) =>
    links.map((link, index) =>
      routeLink(
        link,
        labels.filter((_, other) => other !== index)
      )
    );
  const routeLink = (
    link: (typeof links)[number],
    labels: readonly (Box | undefined)[]
  ): ArrangeEdge => {
    const { from: tail, to: head, directed, text, id, route, field } = link;
    const heads = { start: !directed, end: true };
    const trim = {
      start: heads.start ? headTrim(link.head?.shape, link.head?.size ?? 0) : 0,
      end: headTrim(link.head?.shape, link.head?.size ?? 0)
    };
    const shown = {
      directed,
      heads,
      ...(link.head ? { head: link.head } : {}),
      link: text,
      ...(id ? { id } : {})
    };
    const corners = wires.get(link);
    if (corners?.length) {
      const wire = wirePath(corners, trim);
      return {
        x1: wire.start.x,
        y1: wire.start.y,
        x2: wire.end.x,
        y2: wire.end.y,
        path: wire.path,
        middle: wire.middle,
        ...shown
      };
    }
    const [from, to] = [boxAt(tail), boxAt(head)];
    const obstacles = [
      ...boxes.flatMap((_, box) =>
        box === tail.box || box === head.box ? [] : [boxAt(whole(box))]
      ),
      ...(options.parts ?? [])
        .filter(({ box }) => box === tail.box || box === head.box)
        .map(boxAt)
        .filter((part) => !overlaps(part, from) && !overlaps(part, to)),
      ...labels.flatMap((label) =>
        label && !overlaps(label, from) && !overlaps(label, to) ? [label] : []
      )
    ];
    // An end inside a bigger child, such as a record's pointer field, knows the box around it (its
    // frame, else the child) and the child's other content, so the arrow can meet that box's edge
    // rather than cross that content.
    const surround = (anchor: Anchor, box: Box) => {
      if (anchor.frame === null) return undefined;
      const outer = boxAt(anchor.frame ? { ...anchor.frame, box: anchor.box } : whole(anchor.box));
      const inside =
        outer.right - outer.left > box.right - box.left + 1 ||
        outer.bottom - outer.top > box.bottom - box.top + 1;
      if (!inside) return undefined;
      const parts = (options.parts ?? [])
        .filter((part) => part.box === anchor.box)
        .map(boxAt)
        .filter((part) => !overlaps(part, box));
      return { outer, parts };
    };
    // Each link draws its own curve, from a seed keyed by its id: straight where it can or curving,
    // and to which side, unless its own curve, or its arrangement's curve, says otherwise; it takes
    // the first bend in its order that is clear.
    const draw = (key: string) => options.random?.(`link ${id ?? text}.${key}`) ?? 0.5;
    const style = route === 'wire' ? undefined : (route ?? options.curve);
    const curvy = style ? style === 'curved' : form === 'scatter' || draw('style') >= 0.5;
    const side = draw('side') < 0.5 ? 1 : -1;
    const bends = [0.15, 0.3, 0.5].flatMap((amount) => [amount * side, -amount * side]);
    const order = curvy ? [...bends, 0] : [0, ...bends];
    const routed = routeCurve(from, to, obstacles, order, {
      from: field ? undefined : surround(tail, from),
      to: surround(head, to)
    });
    const drawn = curvePath(routed.curve, trim);
    return {
      x1: drawn.start.x,
      y1: drawn.start.y,
      x2: drawn.end.x,
      y2: drawn.end.y,
      path: drawn.path,
      middle: routed.halfway,
      ...shown
    };
  };
  const first = routeAll([]);
  const labelled = links.some(({ label }) => label);
  const edges = labelled
    ? routeAll(first.map((edge, i) => links[i].label && labelAt(edge.middle, links[i].label)))
    : first;

  return {
    placements,
    edges,
    width,
    height,
    problems,
    choices: { ...(form ? { form } : {}), ...(options.curve ? { curve: options.curve } : {}) }
  };
}

/** One child from each group the links connect, counting an unlinked child as its own group. */
function groupLeaders(count: number, links: readonly { source: number; target: number }[]) {
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const { source, target } of links)
    if (source < count && target < count) parent[root(source)] = root(target);
  return [...new Set(parent.map((_, i) => root(i)))];
}

/** Whether directed link i returns to its source along earlier directed links, closing a cycle. */
function closesCycle(
  links: readonly { source: number; target: number; directed: boolean }[],
  i: number
): boolean {
  const next = new Map<number, number[]>();
  for (const { source, target, directed } of links.slice(0, i))
    if (directed) next.set(source, [...(next.get(source) ?? []), target]);
  const seen = new Set<number>();
  const stack = [links[i].target];
  while (stack.length) {
    const at = stack.pop() as number;
    if (at === links[i].source) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    stack.push(...(next.get(at) ?? []));
  }
  return false;
}

/**
 * A random number in [0, 1) for each key, fixed by a seed and a scope (such as a node's id):
 * FNV-1a over the three, finished with mulberry32.
 */
export function keyedRandom(seed: number, scope: string): (key: string) => number {
  return (key) => {
    let hash = 0x811c9dc5;
    for (const character of `${seed}:${scope}:${key}`)
      hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
    let state = (hash + 0x6d2b79f5) | 0;
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seed an arrangement draws its choices from, derived from its kind's layout seed and the
 * arrangement's scope, so arrangements of one kind differ, and each is reproduced wherever its kind
 * keeps that seed.
 */
export function layoutSeedFor(seed: number, scope: string): number {
  return Math.floor(keyedRandom(seed, scope)('layout seed') * 2 ** 31);
}
