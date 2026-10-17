/**
 * Constraint layout for a node's children with WebCola. Every arrangement is a set of constraints
 * over the children's measured boxes: a row lines them up on one horizontal line in order, a gap
 * apart; a column does the same vertically; free placement only keeps them clear of each other.
 * Links and relations such as "note below cells" add to any of these. Free layouts start from the
 * presentation's seed, so each presentation settles into its own arrangement, and the same seed
 * always gives the same one.
 */

import { Layout } from 'webcola/dist/src/layout';

import { extentOf, findStructure, formCentres, formsFor, sequenceForms, type Form } from './forms';
import { routeCurve, type Box } from './route';

/** One child to place: its key and its size in pixels. */
export type ArrangeBox = { key: string; width: number; height: number };

/** A child's top-left corner, relative to the arrangement's top-left. */
export type Placement = { key: string; x: number; y: number };

/**
 * A link from one child's edge to another's, drawn as a curve (an SVG path) with an arrowhead if
 * directed; x1, y1 and x2, y2 are where it leaves and arrives.
 */
export type ArrangeEdge = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  path: string;
  directed: boolean;
  /** The link this edge draws, as written, such as 'a -> b'. */
  link: string;
  /** The id of the link component it draws, if it came from one. */
  id?: string;
  /** The middle of the curve, where a label goes. */
  middle: { x: number; y: number };
  /** The bend the curve took, as a fraction of its length to one side: 0 is straight. */
  bend: number;
};

export type ArrangeResult = {
  placements: Placement[];
  edges: ArrangeEdge[];
  /** The size that hugs every child. */
  width: number;
  height: number;
  /** Links and constraints that were ignored, with why. */
  problems: string[];
  /** What the seed chose for this arrangement, to report and to pin. */
  choices: LayoutChoices;
};

/** The choices an arrangement drew: the form of its linked structure, if any, and how arrows curve. */
export type LayoutChoices = { form?: Form; curve?: 'straight' | 'curved' };

export type Point = { x: number; y: number };

/** The arrangements the solver places: free, or a row or column with links or relations. */
export type Template = 'free' | 'row' | 'column';

export type ArrangeOptions = {
  template: Template;
  /** How a row's or column's children line up across it. */
  align?: 'start' | 'center' | 'end';
  /** Links such as 'a -> b' (directed) or 'a - b', or link components' specs. */
  links?: readonly (string | LinkSpec)[];
  /**
   * Relations such as 'a below b' (directly below, centred, a gap away), 'a rightOf b', or
   * 'a sameRow b' (centred on one horizontal line, in either order).
   */
  constraints?: readonly string[];
  /** The axis directed links point along in a free arrangement: 'x' or 'y'. */
  flow?: 'x' | 'y';
  /** The space between children, in pixels. */
  gap: number;
  /** A random number in [0, 1) for a key, or undefined to start every child at the centre. */
  random?: (key: string) => number;
  /** The form the linked structure takes; unset, the seed draws one that suits the space. */
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

/** A link from a <Link> component: its ends by key, its id, and a curve style of its own, if any. */
export type LinkSpec = {
  from: string;
  to: string;
  directed: boolean;
  id?: string;
  curve?: 'straight' | 'curved';
  /** An exact bend for this link, as a fraction of its length to one side (0 is straight). */
  bend?: number;
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

/** A box a link attaches to: inside child `box`, relative to that child's top-left. */
export type Anchor = { box: number; x: number; y: number; width: number; height: number };

// The least room left for an arrow between the boxes it joins, so it is always visible.
const arrowRoom = 28;

const relations = ['above', 'below', 'leftOf', 'rightOf', 'sameRow', 'sameColumn'] as const;
type Relation = (typeof relations)[number];

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
  const extent = (axis: 'x' | 'y') => (axis === 'x' ? 'width' : 'height');
  // How far an anchor's centre lies from its child's centre along an axis.
  const offsetOf = (anchor: Anchor, axis: 'x' | 'y') =>
    axis === 'x'
      ? anchor.x + anchor.width / 2 - boxes[anchor.box].width / 2
      : anchor.y + anchor.height / 2 - boxes[anchor.box].height / 2;
  // Box centres a gap apart along an axis, exactly.
  const apart = (axis: 'x' | 'y', left: number, right: number): Separation => ({
    axis,
    left,
    right,
    gap: (boxes[left][extent(axis)] + boxes[right][extent(axis)]) / 2 + options.gap,
    equality: true
  });
  const aligned = (axis: 'x' | 'y', nodes: number[], edge = 'center'): Alignment => ({
    type: 'alignment',
    axis,
    // WebCola places each node's centre at the first node's plus its offset, so half the difference
    // in size lines up starts (or, negated, ends) instead of centres.
    offsets: nodes.map((node) => ({
      node,
      offset:
        edge === 'center'
          ? 0
          : ((edge === 'start' ? 1 : -1) *
              (boxes[node][extent(axis)] - boxes[nodes[0]][extent(axis)])) /
            2
    }))
  });

  // A row or column is its children in order along one axis, lined up across it.
  const template: (Separation | Alignment)[] = [];
  if (options.template !== 'free' && boxes.length) {
    const along = options.template === 'row' ? 'x' : 'y';
    for (let i = 0; i + 1 < boxes.length; i++) template.push(apart(along, i, i + 1));
    template.push(
      aligned(
        along === 'x' ? 'y' : 'x',
        boxes.map((_, i) => i),
        options.align ?? 'center'
      )
    );
  }

  const links = (options.links ?? []).flatMap((link) => {
    const spec = linkSpecOf(link);
    if (!spec) {
      problems.push(`"${link as string}" is not a link such as "a -> b".`);
      return [];
    }
    const text = linkText(spec);
    const from = anchorOf(spec.from, text);
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
            curve: spec.curve,
            bend: spec.bend
          }
        ];
  });

  const related = (options.constraints ?? []).flatMap((text) => {
    const match = /^\s*(\S+)\s+(\S+)\s+(\S+)\s*$/u.exec(text);
    const relation = match?.[2] as Relation | undefined;
    if (!match || !relation || !relations.includes(relation)) {
      problems.push(`"${text}" is not a relation such as "a below b" (${relations.join(', ')}).`);
      return [];
    }
    const a = at(match[1], text);
    const b = at(match[3], text);
    return a === undefined || b === undefined || a === b ? [] : [{ a, b, relation }];
  });
  const constraints = related.flatMap(({ a, b, relation }): (Separation | Alignment)[] => {
    if (relation === 'sameRow' || relation === 'sameColumn')
      return [aligned(relation === 'sameRow' ? 'y' : 'x', [a, b])];
    // "a above b" means directly above, a gap away: exactly apart along one axis, centred on the
    // other, so labels and captions sit by what they describe.
    const axis = relation === 'above' || relation === 'below' ? 'y' : 'x';
    const [left, right] = relation === 'below' || relation === 'rightOf' ? [b, a] : [a, b];
    return [apart(axis, left, right), aligned(axis === 'y' ? 'x' : 'y', [a, b])];
  });

  // Each link's length comes from its own two boxes: half of each plus room for the arrow. With a
  // flow, a directed link's target sits that far along the flow axis, so arrows run along it,
  // except between boxes a relation already places across the flow (such as a label above).
  const flowExtent = options.flow === 'y' ? 'height' : 'width';
  const across = new Set(
    related.flatMap(({ a, b, relation }) => {
      const crossing =
        options.flow === 'y'
          ? ['leftOf', 'rightOf', 'sameRow'].includes(relation)
          : ['above', 'below', 'sameColumn'].includes(relation);
      return crossing ? [`${a} ${b}`, `${b} ${a}`] : [];
    })
  );
  const room = Math.max(3 * options.gap, arrowRoom);
  const laidLinks = links.map(({ source, target, from, to, directed, id, key }) => {
    const along = (from[flowExtent] + to[flowExtent]) / 2 + room;
    const ideal = options.flow
      ? along
      : (Math.max(from.width, from.height) + Math.max(to.width, to.height)) / 2 + room;
    const placed = across.has(`${source} ${target}`);
    return { source, target, from, to, ideal, along, directed, placed, id, key };
  });
  // A link between boxes a relation already places is drawn but not laid out; otherwise its graph
  // distances would pull the rest askew.
  const solvedLinks: { source: number; target: number; ideal: number }[] = laidLinks.filter(
    ({ placed }) => !placed
  );

  // The links of a free arrangement are read for the structure they make, such as a path, a tree,
  // or a layered graph, from links present at every step only, so a link that comes and goes is
  // drawn but does not change it. The structure takes a form: the view's, or one the seed draws from
  // those whose proportions suit the space, so presentations vary in look.
  const structure =
    options.template === 'free'
      ? findStructure(
          boxes.length,
          laidLinks.filter(
            ({ directed, placed, key }) =>
              directed && !placed && (!options.permanent || options.permanent.has(key))
          )
        )
      : undefined;
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
  let form: Form | undefined;
  if (structure) {
    // A flow the view sets rules out forms whose links would run another way.
    const against: Record<'x' | 'y', readonly Form[]> = {
      x: ['tree-down', 'layers-down', 'radial', 'indented'],
      y: ['tree-right', 'layers-right', 'radial']
    };
    const candidates = formsFor(structure).filter(
      (candidate) => !options.flow || !against[options.flow].includes(candidate)
    );
    if (options.form && candidates.includes(options.form)) form = options.form;
    else {
      if (options.form)
        problems.push(
          `The links make a ${structure.kind}, which cannot take the form "${options.form}".`
        );
      // Only forms that can fill the space once stretched, within half again of its proportions.
      const fitting = candidates.filter((candidate) => {
        const centres = placedIn(candidate);
        if (!centres) return false;
        const { width, height } = extentOf([...centres.values()], [...centres.keys()].map(sizeOf));
        return Math.abs(Math.log(width / Math.max(1, height) / aspect)) < Math.log(1.5);
      });
      const choices = fitting.length ? fitting : candidates;
      form = choices[Math.floor((options.random?.('form') ?? 0) * choices.length)];
    }
  }
  const formed = form ? placedIn(form) : undefined;
  const inStructure = new Set(formed ? formed.keys() : []);

  // Along a flow, each directed link's target anchor sits at least a link's length further along
  // than its source anchor, so arrows run with the flow. A link that closes a cycle cannot point
  // forward too, so it is left free; and links forming a simple chain (one out, one in) are lined
  // up on their anchors, so a list runs straight.
  const flowing: (Separation | Alignment)[] = [];
  if (options.flow && options.template === 'free') {
    const axis = options.flow;
    const cross = axis === 'x' ? 'y' : 'x';
    const forward = laidLinks.filter(
      ({ directed, placed }, i) => directed && !placed && !closesCycle(laidLinks, i)
    );
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
    const anchorOfBox = (box: number) =>
      laidLinks.find(({ source }) => source === box)?.from ??
      laidLinks.find(({ target }) => target === box)?.to;
    for (const [node, point] of formed) {
      const anchor = anchorOfBox(node);
      nodes[node].x = startArea.width / 2 + point.x - meanX - (anchor ? offsetOf(anchor, 'x') : 0);
      nodes[node].y = startArea.height / 2 + point.y - meanY - (anchor ? offsetOf(anchor, 'y') : 0);
      nodes[node].fixed = 1;
    }
  }

  // Nothing pulls separate groups together (children joined by links or relations count as one), so
  // in a free arrangement one child of each group is tied to an invisible hub: they gather round it
  // compactly, in an order that depends on where the seed starts them.
  const leaders = groupLeaders(boxes.length, [
    ...solvedLinks,
    ...related.map(({ a, b }) => ({ source: a, target: b }))
  ]);
  if (options.template === 'free' && leaders.length > 1) {
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
    const layout = new Layout()
      .size([startArea.width, startArea.height])
      .nodes(nodes)
      .links(solvedLinks)
      .constraints([...template, ...constraints, ...flowing])
      .avoidOverlaps(true)
      .handleDisconnected(false)
      .linkDistance((link) => (link as unknown as { ideal: number }).ideal);
    // Iterations without constraints, then with the view's, then with all; running on to
    // convergence is synchronous here, and the same input always gives the same result.
    layout.start(20, 20, 20, 0, true, false);
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
  const edges = links.map(({ from: tail, to: head, directed, text, id, curve, bend }) => {
    const [from, to] = [boxAt(tail), boxAt(head)];
    const obstacles = [
      ...boxes.flatMap((_, box) =>
        box === tail.box || box === head.box ? [] : [boxAt(whole(box))]
      ),
      ...(options.parts ?? [])
        .filter(({ box }) => box === tail.box || box === head.box)
        .map(boxAt)
        .filter((part) => !overlaps(part, from) && !overlaps(part, to))
    ];
    // An end inside a bigger child, such as a record's pointer field, knows that child and its other
    // content, so the arrow can meet the child's edge rather than cross that content.
    const surround = (anchor: Anchor, box: Box) => {
      const outer = boxAt(whole(anchor.box));
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
    // and to which side, unless its own curve or bend, or its arrangement's curve, says otherwise. A
    // bend is used exactly; otherwise the link takes the first bend in its order that is clear.
    const draw = (key: string) => options.random?.(`link ${id ?? text}.${key}`) ?? 0.5;
    const style = curve ?? options.curve;
    const curvy = style ? style === 'curved' : form === 'scatter' || draw('style') >= 0.5;
    const side = draw('side') < 0.5 ? 1 : -1;
    const bends = [0.15, 0.3, 0.5].flatMap((amount) => [amount * side, -amount * side]);
    const order = bend !== undefined ? [bend] : curvy ? [...bends, 0] : [0, ...bends];
    const routed = routeCurve(from, to, obstacles, order, {
      from: surround(tail, from),
      to: surround(head, to)
    });
    return {
      x1: routed.start.x,
      y1: routed.start.y,
      x2: routed.end.x,
      y2: routed.end.y,
      path: routed.path,
      directed,
      link: text,
      middle: routed.halfway,
      bend: routed.bend,
      ...(id ? { id } : {})
    };
  });

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
  links: readonly { source: number; target: number; directed: boolean; placed: boolean }[],
  i: number
): boolean {
  const next = new Map<number, number[]>();
  for (const { source, target, directed, placed } of links.slice(0, i))
    if (directed && !placed) next.set(source, [...(next.get(source) ?? []), target]);
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
 * The seed an arrangement draws its choices from, derived from the presentation's seed and the
 * arrangement's scope, so each arrangement differs; pinning it as a node's layoutSeed reproduces
 * that arrangement's layout in any presentation.
 */
export function layoutSeedFor(seed: number, scope: string): number {
  return Math.floor(keyedRandom(seed, scope)('layout seed') * 2 ** 31);
}
