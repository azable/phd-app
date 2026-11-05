/**
 * Forms for linked structures. The links of a free layout are read for the structure they make: a
 * path (such as a linked list), a cycle (a ring buffer), a tree (each node one parent), or a layered
 * graph (directed and acyclic, with merges, or with cycles and a start). Every structure can take
 * every form, drawn from the seed unless the view names one, in its own proportions, so
 * presentations differ in look while showing the same structure, and a layout is the same wherever
 * it is drawn. Anything else is left to the general layout.
 */

/**
 * The structure's own shape (a path in a line, a cycle closed into a ring, a tree branching, a
 * layered graph stacking its layers), then forms that lay any structure out in sequence along its
 * reading order, with links that skip ahead curving round.
 */
export const forms = ['natural', 'line', 'snake', 'wave', 'arc', 'scatter'] as const;
export type Form = (typeof forms)[number];

/**
 * The way a layout with no flow runs, as a flow would: a tree's or layered graph's links down it or
 * across, and a line, a path's own shape, along it.
 */
export const directions = ['down', 'right'] as const;
export type Direction = (typeof directions)[number];
const axisOf = { down: 'y', right: 'x' } as const;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * The structure a layout's links make, over the nodes that take part in it, in reading order: along
 * a path or cycle, depth first through a tree, or topologically through a layered graph (breadth
 * first where it has cycles).
 */
export type Structure =
  | { kind: 'path' | 'cycle'; nodes: number[] }
  | { kind: 'tree'; nodes: number[]; root: number; children: Map<number, number[]> }
  | {
      kind: 'layers';
      nodes: number[];
      parents: Map<number, number[]>;
      /**
       * Each node's layer where links are read away from a start, undirected ones or a graph with
       * cycles: its distance from it.
       */
      depths?: Map<number, number>;
    };

/** What a structure is: a path, a cycle, a tree, or a layered graph. */
export type StructureKind = Structure['kind'];

/**
 * The structure the largest group of linked nodes makes, from links in the order written, or
 * undefined when it is too small (fewer than three nodes) or has cycles beyond a single ring and no
 * start (a node no link points to) reaching every node. A link with directed false, a pair drawn as
 * one line, joins its nodes either way (see oriented).
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
  const roots = nodes.filter((node) => ins(node) === 0);
  if (!acyclic(nodes, children)) {
    // A graph with cycles but a start, as a directed graph a search walks from its source: layers
    // by distance from its starts, read breadth first, with links back up drawn across them. With
    // no start, or nodes no start reaches, it is left to the general layout.
    const depths = new Map(roots.map((root) => [root, 0]));
    for (const queue = [...roots]; queue.length; ) {
      const node = queue.shift() as number;
      for (const child of children.get(node) ?? [])
        if (!depths.has(child)) {
          depths.set(child, (depths.get(node) as number) + 1);
          queue.push(child);
        }
    }
    if (!roots.length || depths.size < nodes.length) return undefined;
    return { kind: 'layers', nodes: [...depths.keys()], parents, depths };
  }
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
 * form's free parameters, such as a wave's height or a node order. A tree or layered graph's own
 * shape, and a line, run along the flow, else the direction: unset, a tree branches down and a line
 * lies along x. The other sequence forms lie along x unless the flow is y.
 */
export function formCentres(
  form: Form,
  structure: Structure,
  sizeOf: (node: number) => Size,
  options: {
    /** Between linked nodes: an arrow's room, and its label's where links have labels. */
    room: number;
    /** Between nodes no link joins, side by side in a layer: an arrow's room; the room if unset. */
    apart?: number;
    random: (key: string) => number;
    flow?: 'x' | 'y';
    direction?: Direction;
  }
): Map<number, Point> {
  const sizes = structure.nodes.map(sizeOf);
  // One step fits the widest node and room for an arrow; rows fit the tallest node and an arrow.
  const across = Math.max(...sizes.map(({ width }) => width)) + options.room;
  const down = Math.max(...sizes.map(({ height }) => height)) + options.room;
  const step = { across, down };
  const runs = options.flow ?? (options.direction && axisOf[options.direction]);
  if (form === 'natural' && (structure.kind === 'tree' || structure.kind === 'layers')) {
    // Layers lie a node's depth and room for an arrow and its label apart, the way links run; nodes
    // in a layer a node's breadth and an arrow's room apart, so arrows fanning out from one node
    // stay apart: no link runs between neighbours in a layer to need its label's room. Each layer
    // keeping the widest label's room both ways spread project c0dc2b85's ten small vertices over
    // 813×897 px, drawn at 61% with 10 px text.
    const sideways = runs === 'x';
    const apart = options.apart ?? options.room;
    const fanned = {
      along: (sideways ? down : across) - options.room + apart,
      deep: sideways ? across : down
    };
    const breadth = (node: number) => {
      const { width, height } = sizeOf(node);
      return sideways ? height : width;
    };
    const placed =
      structure.kind === 'tree'
        ? treeCentres(structure, fanned, breadth, apart)
        : layerCentres(structure, fanned, options.random);
    return new Map(
      [...placed].map(([node, { along, deep }]) => [
        node,
        sideways ? { x: deep, y: along } : { x: along, y: deep }
      ])
    );
  }
  // A cycle's own shape is a ring, whichever way it runs, and a path's a line. Sequence forms lie
  // along x, and running along y turns them, swapping each centre's axes and the steps they take,
  // so a column of tall nodes keeps room for its arrows.
  const ring = form === 'natural' && structure.kind === 'cycle';
  const shape = form === 'natural' ? (ring ? 'ring' : 'line') : form;
  const turned = !ring && (shape === 'line' ? runs : options.flow) === 'y';
  const placed = sequenceCentres(
    shape,
    sizes.length,
    structure.kind === 'cycle',
    turned ? { across: down, down: across } : step,
    options
  );
  return new Map(
    structure.nodes.map((node, i) => [
      node,
      turned ? { x: placed[i].y, y: placed[i].x } : placed[i]
    ])
  );
}

type Step = { across: number; down: number };

function sequenceCentres(
  form: Exclude<Form, 'natural'> | 'ring',
  count: number,
  cycle: boolean,
  { across, down }: Step,
  options: { random: (key: string) => number; room: number }
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
      // or spiralling inwards, as the seed chooses, each node nudged within its cell. A cell is a
      // step, a node and an arrow's room, and the nudge at most two fifths of that room each way,
      // so neighbours keep a fifth of it apart: a scattered graph is no sparser than a line.
      const cell = { x: across, y: down };
      const nudge = options.room * 0.8;
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
        x: cells[i].x * cell.x + (options.random(`scatter.${i}.x`) - 0.5) * nudge,
        y: cells[i].y * cell.y + (options.random(`scatter.${i}.y`) - 0.5) * nudge
      }));
    }
    default:
      // A line.
      return indices.map((i) => ({ x: i * across, y: 0 }));
  }
}

/** Where a tree or layered graph places a node: along its layer, and how deep, in pixels. */
type Layered = Map<number, { along: number; deep: number }>;
type Spacing = { along: number; deep: number };

function treeCentres(
  { root, children }: Extract<Structure, { kind: 'tree' }>,
  { deep }: Spacing,
  breadth: (node: number) => number,
  gap: number
): Layered {
  // Each subtree takes as much room along its layer as its own nodes need, its children side by
  // side under it with a gap, so a leaf narrower than the widest node takes only its own room, as
  // a merge sort's tree of calls narrows to single values; a parent sits over the middle of its
  // children. Depth is the number of links from the root.
  const extents = new Map<number, number>();
  const extentOf = (node: number): number => {
    const kids = children.get(node) ?? [];
    const under = kids.reduce((total, kid) => total + extentOf(kid), 0) + gap * (kids.length - 1);
    const extent = Math.max(breadth(node), kids.length ? under : 0);
    extents.set(node, extent);
    return extent;
  };
  extentOf(root);
  const placed: Layered = new Map();
  const visit = (node: number, level: number, start: number): number => {
    const kids = children.get(node) ?? [];
    const extent = extents.get(node)!;
    const under =
      kids.reduce((total, kid) => total + extents.get(kid)!, 0) + gap * (kids.length - 1);
    let at = start + (extent - under) / 2;
    const centres = kids.map((kid) => {
      const centre = visit(kid, level + 1, at);
      at += extents.get(kid)! + gap;
      return centre;
    });
    const centre = centres.length
      ? (centres[0] + centres[centres.length - 1]) / 2
      : start + extent / 2;
    placed.set(node, { along: centre, deep: level * deep });
    return centre;
  };
  visit(root, 0, 0);
  return placed;
}

/**
 * A layered graph drawn as Sugiyama et al. (1981) do: each node in a layer, links spanning several
 * layers passing through a stand-in at each between, so they keep a lane; nodes in each layer
 * ordered by where their neighbours are, sweeping down and up and keeping the order that crosses
 * fewest links; then each node set over its neighbours as near as its layer's order allows.
 */
function layerCentres(
  { nodes, parents, depths }: Extract<Structure, { kind: 'layers' }>,
  { along, deep }: Spacing,
  random?: (key: string) => number
): Layered {
  // Each node sits one layer below its deepest parent, or, given depths (an undirected graph, or
  // one with cycles), at its distance from its start.
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
  const rows: number[][] = Array.from({ length: Math.max(...layer.values()) + 1 }, () => []);
  for (const node of nodes) rows[layer.get(node) as number].push(node);

  // Links between layers, each from its upper end; stand-ins have negative numbers. Links within a
  // layer lie along it and do not order it.
  const below = new Map<number, number[]>();
  const above = new Map<number, number[]>();
  const join = (upper: number, lower: number) => {
    below.set(upper, [...(below.get(upper) ?? []), lower]);
    above.set(lower, [...(above.get(lower) ?? []), upper]);
  };
  let stand = -1;
  for (const node of nodes)
    for (const parent of parents.get(node) ?? []) {
      const [upper, lower] = [parent, node].sort(
        (a, b) => (layer.get(a) as number) - (layer.get(b) as number)
      );
      const [top, bottom] = [layer.get(upper) as number, layer.get(lower) as number];
      if (top === bottom) continue;
      let at = upper;
      for (let level = top + 1; level < bottom; level++) {
        rows[level].push(stand);
        layer.set(stand, level);
        join(at, stand);
        at = stand--;
      }
      join(at, lower);
    }

  // Ordering: each node by the mean place of its neighbours in the layer before, ties kept in the
  // order they were, at first the reading order, so a node's neighbours lie as its links list them.
  const place = new Map<number, number>();
  const index = () => rows.forEach((row) => row.forEach((node, i) => place.set(node, i)));
  const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const order = (row: number[], by: ReadonlyMap<number, number[]>) => {
    const key = new Map(
      row.map((node, i) => {
        const near = by.get(node) ?? [];
        return [node, near.length ? mean(near.map((other) => place.get(other) ?? 0)) : i];
      })
    );
    row.sort((a, b) => (key.get(a) as number) - (key.get(b) as number));
    row.forEach((node, i) => place.set(node, i));
  };
  const crossings = () => {
    let count = 0;
    for (const row of rows) {
      const links = row.flatMap((upper) =>
        (below.get(upper) ?? []).map((lower) => [place.get(upper), place.get(lower)] as number[])
      );
      for (const [i, [u1, l1]] of links.entries())
        for (const [u2, l2] of links.slice(i + 1)) if ((u1 - u2) * (l1 - l2) < 0) count++;
    }
    return count;
  };
  // The seed chooses the order each layer starts in, so seeds settle into different orders, each
  // as few crossings as the sweeps find from it, rather than all into the reading order's.
  if (random)
    for (const row of rows) row.sort((a, b) => random(`layers.${a}`) - random(`layers.${b}`));
  index();
  for (const row of rows.slice(1)) order(row, above);
  let best = rows.map((row) => [...row]);
  let fewest = crossings();
  // Sweeps down and up, as many as settle the small graphs of algorithms.
  for (let sweep = 1; sweep < 8 && fewest > 0; sweep++) {
    if (sweep % 2) for (const row of rows.slice(0, -1).reverse()) order(row, below);
    else for (const row of rows.slice(1)) order(row, above);
    const now = crossings();
    if (now < fewest) [fewest, best] = [now, rows.map((row) => [...row])];
  }
  best.forEach((row, level) => (rows[level] = row));
  index();

  // Placing: in slots a node wide, a stand-in half one; each layer packed, then set over its
  // neighbours, down, up, and down again, as near as keeping its order and slots allows.
  const width = (node: number) => (node >= 0 ? 1 : 0.5);
  const at = new Map<number, number>();
  const settle = (row: readonly number[], wanted: readonly number[]) =>
    keptApart(
      wanted,
      row.map((node, i) => (i ? (width(row[i - 1]) + width(node)) / 2 : 0))
    ).forEach((value, i) => at.set(row[i], value));
  for (const row of rows)
    settle(
      row,
      row.map(() => 0)
    );
  const toward = (row: readonly number[], by: ReadonlyMap<number, number[]>) =>
    settle(
      row,
      row.map((node) => {
        const near = by.get(node) ?? [];
        return near.length ? mean(near.map((other) => at.get(other) ?? 0)) : (at.get(node) ?? 0);
      })
    );
  for (const pass of [0, 1, 2]) {
    if (pass % 2) for (const row of rows.slice(0, -1).reverse()) toward(row, below);
    else for (const row of rows.slice(1)) toward(row, above);
  }
  return new Map(
    nodes.map((node) => [
      node,
      { along: (at.get(node) ?? 0) * along, deep: (layer.get(node) ?? 0) * deep }
    ])
  );
}

/**
 * Places in order, each at least its gap after the one before, as near as they can be to the places
 * wanted (least squares): the pool-adjacent-violators algorithm over the places less their gaps.
 */
function keptApart(wanted: readonly number[], gaps: readonly number[]): number[] {
  const offsets: number[] = [];
  gaps.forEach((gap, i) => offsets.push((offsets[i - 1] ?? 0) + gap));
  const pools: { sum: number; count: number }[] = [];
  wanted.forEach((value, i) => {
    pools.push({ sum: value - offsets[i], count: 1 });
    while (pools.length > 1) {
      const [before, last] = pools.slice(-2);
      if (before.sum / before.count <= last.sum / last.count) break;
      pools.splice(-2, 2, { sum: before.sum + last.sum, count: before.count + last.count });
    }
  });
  return pools
    .flatMap(({ sum, count }) => Array<number>(count).fill(sum / count))
    .map((value, i) => value + offsets[i]);
}
