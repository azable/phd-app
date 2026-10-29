/**
 * Forms for linked structures. The links of a free layout are read for the structure they make: a
 * path (such as a linked list), a cycle (a ring buffer), a tree (each node one parent), or a layered
 * graph (directed and acyclic, with merges). Each structure has several forms, drawn from the seed
 * unless the view names one, in its own proportions, so presentations differ in look while showing
 * the same structure, and a layout is the same wherever it is drawn. Anything else is left to the
 * general layout.
 */

/** Forms that lay any structure out in sequence, along its reading order. */
export const sequenceForms = ['line', 'snake', 'wave', 'arc', 'scatter'] as const;
export const cycleForms = ['ring'] as const;
export const treeForms = ['tree-down', 'tree-right', 'radial', 'indented'] as const;
export const layerForms = ['layers-down', 'layers-right'] as const;
export const forms = [
  ...sequenceForms,
  ...cycleForms,
  ...treeForms,
  ...layerForms
] as readonly Form[];
export type Form =
  | (typeof sequenceForms)[number]
  | (typeof cycleForms)[number]
  | (typeof treeForms)[number]
  | (typeof layerForms)[number];

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * The structure a layout's links make, over the nodes that take part in it, in reading order: along
 * a path or cycle, depth first through a tree, or topologically through a layered graph.
 */
export type Structure =
  | { kind: 'path' | 'cycle'; nodes: number[] }
  | { kind: 'tree'; nodes: number[]; root: number; children: Map<number, number[]> }
  | {
      kind: 'layers';
      nodes: number[];
      parents: Map<number, number[]>;
      /** Each node's layer where undirected links are read away from a root: its distance from it. */
      depths?: Map<number, number>;
    };

/** What a structure is: a path, a cycle, a tree, or a layered graph. */
export type StructureKind = Structure['kind'];

/** The forms whose links would run against a flow, which a layout with that flow leaves out. */
const against: Record<'x' | 'y', readonly Form[]> = {
  x: ['tree-down', 'layers-down', 'radial', 'indented'],
  y: ['tree-right', 'layers-right', 'radial']
};

/**
 * The forms a structure can take, along its flow if it has one. Any structure can be laid out in
 * sequence along its reading order, with links that skip ahead curving round; a cycle can also
 * close into a ring, a tree branch out, and a layered graph stack its layers.
 */
export function formsFor(kind: StructureKind, flow?: 'x' | 'y'): readonly Form[] {
  const forms: readonly Form[] =
    kind === 'cycle'
      ? [...cycleForms, ...sequenceForms]
      : kind === 'tree'
        ? [...sequenceForms, ...treeForms]
        : kind === 'layers'
          ? [...sequenceForms, ...layerForms]
          : sequenceForms;
  return flow ? forms.filter((form) => !against[flow].includes(form)) : forms;
}

/**
 * The form a structure takes unless its kind names another it can take: a path in a line, a cycle
 * in a ring, a tree branching down, or rightwards along x, a layered graph in layers likewise.
 */
export function naturalForm(kind: StructureKind, flow?: 'x' | 'y'): Form {
  if (kind === 'cycle') return 'ring';
  if (kind === 'tree') return flow === 'x' ? 'tree-right' : 'tree-down';
  if (kind === 'layers') return flow === 'x' ? 'layers-right' : 'layers-down';
  return 'line';
}

/**
 * The structure the largest group of linked nodes makes, from links in the order written, or
 * undefined when it is too small (fewer than three nodes) or has cycles beyond a single ring. A link
 * with directed false, a pair drawn as one line, joins its nodes either way (see oriented).
 */
export function findStructure(
  count: number,
  links: readonly { source: number; target: number; directed?: boolean }[]
): Structure | undefined {
  const edges = links.filter(
    ({ source, target }) => source < count && target < count && source !== target
  );
  // The largest group of nodes the links join, ignoring direction.
  const group = new Map<number, number>();
  const find = (node: number): number => {
    const parent = group.get(node) ?? node;
    if (parent === node) return node;
    const root = find(parent);
    group.set(node, root);
    return root;
  };
  for (const { source, target } of edges) group.set(find(source), find(target));
  const sizes = new Map<number, number[]>();
  for (const node of new Set(edges.flatMap(({ source, target }) => [source, target])))
    sizes.set(find(node), [...(sizes.get(find(node)) ?? []), node]);
  const nodes = [...sizes.values()].sort((a, b) => b.length - a.length || a[0] - b[0])[0];
  if (!nodes || nodes.length < 3) return undefined;
  const members = new Set(nodes);
  const { links: inside, depths } = oriented(
    nodes,
    edges.filter(({ source }) => members.has(source))
  );
  const children = new Map<number, number[]>();
  const parents = new Map<number, number[]>();
  for (const { source, target } of inside) {
    if (children.get(source)?.includes(target)) continue;
    children.set(source, [...(children.get(source) ?? []), target]);
    parents.set(target, [...(parents.get(target) ?? []), source]);
  }
  const outs = (node: number) => children.get(node)?.length ?? 0;
  const ins = (node: number) => parents.get(node)?.length ?? 0;

  // A path or a cycle: every node at most one link in and one out.
  if (nodes.every((node) => outs(node) <= 1 && ins(node) <= 1)) {
    const start = nodes.find((node) => ins(node) === 0);
    const order: number[] = [];
    for (
      let at: number | undefined = start ?? Math.min(...nodes);
      at !== undefined && !order.includes(at);
      at = children.get(at)?.[0]
    )
      order.push(at);
    return { kind: start === undefined ? 'cycle' : 'path', nodes: order };
  }
  if (!acyclic(nodes, children)) return undefined;
  const roots = nodes.filter((node) => ins(node) === 0);
  // A tree: one root, and every other node one parent; read depth first, so a node is followed by
  // its subtree.
  if (roots.length === 1 && nodes.every((node) => ins(node) <= 1)) {
    const order: number[] = [];
    const visit = (node: number) => {
      order.push(node);
      for (const child of children.get(node) ?? []) visit(child);
    };
    visit(roots[0]);
    return { kind: 'tree', nodes: order, root: roots[0], children };
  }
  // Otherwise a layered graph, read in topological order: each node after all its parents, ties
  // kept in the order the nodes were written.
  const waiting = new Map(nodes.map((node) => [node, ins(node)]));
  const ready = nodes.filter((node) => ins(node) === 0).sort((a, b) => a - b);
  const order: number[] = [];
  while (ready.length) {
    const node = ready.shift() as number;
    order.push(node);
    for (const child of children.get(node) ?? []) {
      const left = (waiting.get(child) ?? 1) - 1;
      waiting.set(child, left);
      if (left === 0) ready.push(child);
    }
    ready.sort((a, b) => a - b);
  }
  return { kind: 'layers', nodes: order, parents, ...(depths ? { depths } : {}) };
}

/**
 * A group's links with each undirected one given the direction it is read in: away from a root,
 * nearer first and, at one distance, from the earlier node, so an undirected graph reads as a tree
 * or layers from its first node. All undirected, a ring is read round from its first node and a
 * path from its first end, as directed ones are, and every other group also gives each node's
 * distance from the root, its layer.
 */
function oriented(
  nodes: readonly number[],
  edges: readonly { source: number; target: number; directed?: boolean }[]
): { links: { source: number; target: number }[]; depths?: Map<number, number> } {
  if (edges.every(({ directed }) => directed !== false)) return { links: [...edges] };
  const neighbours = new Map<number, Set<number>>(nodes.map((node) => [node, new Set()]));
  for (const { source, target } of edges) {
    neighbours.get(source)?.add(target);
    neighbours.get(target)?.add(source);
  }
  const degree = (node: number) => neighbours.get(node)?.size ?? 0;
  const pairs = nodes.reduce((sum, node) => sum + degree(node), 0) / 2;
  const plain = edges.every(({ directed }) => directed === false);
  const first = Math.min(...nodes);
  if (plain && pairs === nodes.length && nodes.every((node) => degree(node) === 2)) {
    const ring: { source: number; target: number }[] = [];
    for (let at = first, next = Math.min(...(neighbours.get(first) ?? [])); ; ) {
      ring.push({ source: at, target: next });
      if (next === first) return { links: ring };
      const after = [...(neighbours.get(next) ?? [])].find((node) => node !== at) as number;
      [at, next] = [next, after];
    }
  }
  const pointedAt = new Set(
    edges.flatMap(({ target, directed }) => (directed === false ? [] : [target]))
  );
  const root =
    plain && pairs === nodes.length - 1 && nodes.every((node) => degree(node) <= 2)
      ? Math.min(...nodes.filter((node) => degree(node) === 1))
      : (nodes.filter((node) => !pointedAt.has(node)).sort((a, b) => a - b)[0] ?? first);
  const depth = new Map([[root, 0]]);
  for (const queue = [root]; queue.length; ) {
    const node = queue.shift() as number;
    for (const next of [...(neighbours.get(node) ?? [])].sort((a, b) => a - b))
      if (!depth.has(next)) {
        depth.set(next, (depth.get(node) as number) + 1);
        queue.push(next);
      }
  }
  const links = edges.map(({ source, target, directed }) => {
    const [from, to] = [depth.get(source) ?? 0, depth.get(target) ?? 0];
    return directed !== false || from < to || (from === to && source < target)
      ? { source, target }
      : { source: target, target: source };
  });
  // All undirected, layers are distances from the root, so links between nodes at one distance lie
  // along a layer rather than pushing one of them a layer further.
  return plain ? { links, depths: depth } : { links };
}

function acyclic(nodes: readonly number[], children: ReadonlyMap<number, number[]>): boolean {
  const state = new Map<number, 'open' | 'done'>();
  const visit = (node: number): boolean => {
    if (state.get(node) === 'done') return true;
    if (state.get(node) === 'open') return false;
    state.set(node, 'open');
    const ok = (children.get(node) ?? []).every(visit);
    state.set(node, 'done');
    return ok;
  };
  return nodes.every(visit);
}

/**
 * Centres for a structure's nodes in a form, in the form's own proportions. `random` varies each
 * form's free parameters, such as a wave's height or a node order.
 */
export function formCentres(
  form: Form,
  structure: Structure,
  sizeOf: (node: number) => Size,
  options: { room: number; random: (key: string) => number }
): Map<number, Point> {
  const sizes = structure.nodes.map(sizeOf);
  // One step fits the widest node and room for an arrow; rows fit the tallest node and an arrow.
  const across = Math.max(...sizes.map(({ width }) => width)) + options.room;
  const down = Math.max(...sizes.map(({ height }) => height)) + options.room;
  const step = { across, down };
  let centres: Map<number, Point>;
  // Sequence forms, and a ring, run along the structure's reading order, whatever its shape.
  const inSequence =
    (sequenceForms as readonly Form[]).includes(form) ||
    (cycleForms as readonly Form[]).includes(form);
  if (!inSequence && structure.kind === 'tree')
    centres = treeCentres(form, structure, step, options.random);
  else if (!inSequence && structure.kind === 'layers')
    centres = layerCentres(form, structure, step, options.random);
  else {
    const placed = sequenceCentres(form, sizes.length, structure.kind === 'cycle', step, options);
    centres = new Map(structure.nodes.map((node, i) => [node, placed[i]]));
  }
  return centres;
}

type Step = { across: number; down: number };

function sequenceCentres(
  form: Form,
  count: number,
  cycle: boolean,
  { across, down }: Step,
  options: { random: (key: string) => number }
): Point[] {
  const pick = (key: string, low: number, high: number) => low + options.random(key) * (high - low);
  const indices = Array.from({ length: count }, (_, i) => i);
  // As many rows as bring a grid of cells closest to a square, from the count and the cells alone.
  const rowsFor = (cell: Point) => {
    let rows = 1;
    let closest = Infinity;
    for (let candidate = 1; candidate <= count; candidate++) {
      const columns = Math.ceil(count / candidate);
      const mismatch = Math.abs(Math.log((columns * cell.x) / (candidate * cell.y)));
      if (mismatch < closest) [rows, closest] = [candidate, mismatch];
    }
    return rows;
  };
  switch (form) {
    case 'snake': {
      // Rows read back and forth.
      const rows = rowsFor({ x: across, y: down * 1.25 });
      const columns = Math.ceil(count / rows);
      return indices.map((i) => {
        const row = Math.floor(i / columns);
        const column = row % 2 ? columns - 1 - (i % columns) : i % columns;
        return { x: column * across, y: row * down * 1.25 };
      });
    }
    case 'wave': {
      // Alternately up and down, or along a smooth swell, by an amount the seed chooses.
      const height = down * pick('wave.height', 0.6, 1.3);
      const smooth = options.random('wave.smooth') < 0.5;
      return indices.map((i) => ({
        x: i * across * 0.85,
        y: smooth ? height * Math.sin((i * Math.PI) / 2) : (i % 2) * height
      }));
    }
    case 'arc':
    case 'ring': {
      // A ring closes the circle; an arc sweeps part of one, bulging up or down.
      const ring = form === 'ring' || cycle;
      const sweep = ring ? 2 * Math.PI : pick('arc.sweep', 0.6, 1.2) * Math.PI;
      const steps = ring ? count : count - 1;
      const radius = Math.max(across, (steps * across) / sweep);
      const start = ring ? options.random('ring.start') * 2 * Math.PI : -sweep / 2;
      const flip = !ring && options.random('arc.flip') < 0.5 ? -1 : 1;
      return indices.map((i) => {
        const angle = start + (i * sweep) / steps;
        return { x: radius * Math.sin(angle), y: -flip * radius * Math.cos(angle) };
      });
    }
    case 'scatter': {
      // Free positions that keep each node near the next: a walk over a grid by rows, by columns,
      // or spiralling inwards, as the seed chooses, each node nudged within its cell.
      const cell = { x: across * 1.35, y: down * 1.5 };
      const rows = rowsFor(cell);
      const columns = Math.ceil(count / rows);
      const walk = ['rows', 'columns', 'spiral'][Math.floor(options.random('scatter.walk') * 3)];
      const cells: Point[] = [];
      if (walk === 'spiral')
        for (let ring = 0; cells.length < rows * columns; ring++) {
          const [left, top, right, bottom] = [ring, ring, columns - 1 - ring, rows - 1 - ring];
          for (let x = left; x <= right; x++) cells.push({ x, y: top });
          for (let y = top + 1; y <= bottom; y++) cells.push({ x: right, y });
          if (bottom > top) for (let x = right - 1; x >= left; x--) cells.push({ x, y: bottom });
          if (right > left) for (let y = bottom - 1; y > top; y--) cells.push({ x: left, y });
        }
      else
        for (let i = 0; i < rows * columns; i++) {
          const major = walk === 'rows' ? columns : rows;
          const line = Math.floor(i / major);
          const along = line % 2 ? major - 1 - (i % major) : i % major;
          cells.push(walk === 'rows' ? { x: along, y: line } : { x: line, y: along });
        }
      return indices.map((i) => ({
        x: (cells[i].x + (options.random(`scatter.${i}.x`) - 0.5) * 0.5) * cell.x,
        y: (cells[i].y + (options.random(`scatter.${i}.y`) - 0.5) * 0.5) * cell.y
      }));
    }
    default:
      // A line, and any form meant for another structure.
      return indices.map((i) => ({ x: i * across, y: 0 }));
  }
}

function treeCentres(
  form: Form,
  { root, children }: Extract<Structure, { kind: 'tree' }>,
  { across, down }: Step,
  random: (key: string) => number
): Map<number, Point> {
  // Leaves take consecutive slots and a parent sits over the middle of its children; depth is the
  // number of links from the root. The indented form lists nodes in order instead, by depth.
  const slot = new Map<number, number>();
  const depth = new Map<number, number>();
  const order: number[] = [];
  let leaves = 0;
  const visit = (node: number, level: number) => {
    depth.set(node, level);
    order.push(node);
    const kids = children.get(node) ?? [];
    if (!kids.length) slot.set(node, leaves++);
    else {
      for (const kid of kids) visit(kid, level + 1);
      slot.set(node, ((slot.get(kids[0]) ?? 0) + (slot.get(kids[kids.length - 1]) ?? 0)) / 2);
    }
  };
  visit(root, 0);
  const place = (node: number): Point => {
    const s = slot.get(node) ?? 0;
    const d = depth.get(node) ?? 0;
    switch (form) {
      case 'tree-right':
        return { x: d * across * 1.4, y: s * down };
      case 'radial': {
        // Rings round the root, over a sweep the seed chooses.
        const sweep = (1.2 + random('radial.sweep') * 0.8) * Math.PI;
        const angle = (s / Math.max(1, leaves)) * sweep;
        const radius = d * Math.max(across, down) * 1.2;
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      }
      case 'indented':
        return { x: d * across * 0.6, y: order.indexOf(node) * down };
      default:
        return { x: s * across, y: d * down * 1.4 };
    }
  };
  return new Map(order.map((node) => [node, place(node)]));
}

function layerCentres(
  form: Form,
  { nodes, parents, depths }: Extract<Structure, { kind: 'layers' }>,
  { across, down }: Step,
  random: (key: string) => number
): Map<number, Point> {
  // Each node sits one layer below its deepest parent, or, in an undirected graph, at its distance
  // from the root; within a layer, nodes are ordered by where their parents are, with the seed
  // breaking ties.
  const layer = new Map<number, number>();
  const layerOf = (node: number, seen = new Set<number>()): number => {
    if (layer.has(node)) return layer.get(node) as number;
    seen.add(node);
    const above = (parents.get(node) ?? []).filter((parent) => !seen.has(parent));
    const value = above.length ? Math.max(...above.map((parent) => layerOf(parent, seen))) + 1 : 0;
    layer.set(node, value);
    return value;
  };
  for (const node of nodes) layer.set(node, depths?.get(node) ?? layerOf(node));
  const layers: number[][] = [];
  for (const node of nodes) (layers[layer.get(node) ?? 0] ??= []).push(node);
  const position = new Map<number, number>();
  for (const row of layers.filter(Boolean)) {
    const weight = (node: number) => {
      const above = (parents.get(node) ?? []).map((parent) => position.get(parent) ?? 0);
      return (
        (above.length ? above.reduce((sum, p) => sum + p, 0) / above.length : 0) +
        random(`layer.${node}`) * 0.01
      );
    };
    row.sort((a, b) => weight(a) - weight(b));
    row.forEach((node, i) => position.set(node, i - (row.length - 1) / 2));
  }
  const sideways = form === 'layers-right';
  return new Map(
    nodes.map((node) => {
      const along = (position.get(node) ?? 0) * (sideways ? down : across);
      const deep = (layer.get(node) ?? 0) * (sideways ? across : down) * 1.4;
      return [node, sideways ? { x: deep, y: along } : { x: along, y: deep }];
    })
  );
}
