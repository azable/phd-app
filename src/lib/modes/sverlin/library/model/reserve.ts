/**
 * The layout memory worked out on the layout model from steps' markup, as Svelte's string renderer
 * writes it, before any step is mounted (see LayoutMemory). Sizes compose bottom up:
 *
 * - a typed component's root keeps its component's box, the largest it draws over the values of
 *   its parameters (see components.server.ts), one fixed box wherever it is used;
 * - any other node keeps the largest size it reaches at any step, laid out with the sizes the nodes
 *   inside it keep, so it holds them at every step;
 * - the items of a collection all keep the largest any of them reaches;
 * - a grid's columns and rows each keep the largest any of their cells reaches at any step, and
 *   the node holding it is sized with those tracks;
 * - a free layout is solved once over every step from its children's sizes (see node/span.ts), and
 *   the node holding it is sized with it at that size.
 *
 * Each node is laid out on its own, and nodes alike, by their looks, their text and the sizes
 * inside them, only once: a node holding the same values at many steps costs one layout.
 */

import { flowExtent, neededFit } from '../fit';
import { arrangeChildren, arrangementInput, type ArrangementProps } from '../node/arrangement';
import { overlayRoom, routeOverlay, type Sides } from '../node/overlay';
import type { Reader } from '../node/reader';
import { solveRecorded } from '../node/span';
import type { LayoutMemory } from '../type-context';
import type { Rule } from './css';
import { layOut, type Box, type ModelLayout, type TextMeasure } from './layout';
import type { Look, Styled, Styler } from './look';
import { classesOf, isElement, type ModelElement } from './tree';

type Size = { width: number; height: number };

/** A step's markup, or, with no step, markup drawn only to make room, as for other values. */
export type Drawing = { step?: number; markup: ModelElement };

export type ReserveOptions = {
  rules: readonly Rule[];
  measure: TextMeasure;
  styler: Styler;
  devicePixelRatio: number;
  /** The page's elements around each markup's root, outermost first. */
  ancestors: readonly ModelElement[];
  memory: LayoutMemory;
};

/** How the nodes were sized, for timing reports. */
export type Reservation = {
  /** Typed components whose box their roots keep. */
  components: number;
  /**
   * Nodes keeping the largest size they reach over the steps, as no component's box holds them,
   * how many by their kind; and free layouts solved over the steps.
   */
  nodes: Record<string, number>;
  arrangements: number;
  /** Elements laid out on the model, each laid out once for all those alike. */
  layouts: number;
};

type Kind =
  | { kind: 'boxed'; size: Size }
  | { kind: 'reserved'; key: string; id: string }
  | { kind: 'grid'; key: string; id: string }
  | { kind: 'arranged'; key: string; props: ArrangementProps };

/** A drawing read for sizing: its looks, its parents, and what decides each node's size. */
type Read = {
  drawing: Drawing;
  flow: ModelElement;
  frame: ModelElement;
  styled: Map<ModelElement, Styled>;
  parents: Map<ModelElement, ModelElement>;
  kinds: Map<ModelElement, Kind>;
  /** Each collection's items, by node id. */
  collections: Map<string, Set<string>>;
};

const elementsOf = (element: ModelElement) => element.children.filter(isElement);

function find(element: ModelElement, name: string): ModelElement | undefined {
  if (classesOf(element).includes(name)) return element;
  for (const child of elementsOf(element)) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

/** What sizes nodes on the model, sharing looks and layouts between the drawings it reads. */
function sizer(options: ReserveOptions) {
  const { memory, styler, rules, measure, devicePixelRatio } = options;
  const styledIds = new Map<Styled, number>();
  const idOf = (styled: Styled | undefined) => {
    if (!styled) return -1;
    let id = styledIds.get(styled);
    if (id === undefined) styledIds.set(styled, (id = styledIds.size));
    return id;
  };

  function read(drawing: Drawing): Read | undefined {
    const frame = find(drawing.markup, 'sv-frame');
    const flow = frame && find(frame, 'sv-flow');
    if (!frame || !flow) return undefined;
    const styled = new Map<ModelElement, Styled>();
    const parents = new Map<ModelElement, ModelElement>();
    const chain = [...options.ancestors];
    let above: Styled | undefined;
    options.ancestors.forEach((element, depth) => {
      above = styler(element, options.ancestors.slice(0, depth), above);
    });
    const style = (element: ModelElement, parent: Styled | undefined) => {
      const own = styler(element, chain, parent);
      styled.set(element, own);
      chain.push(element);
      for (const child of elementsOf(element)) {
        parents.set(child, element);
        style(child, own);
      }
      chain.pop();
    };
    style(drawing.markup, above);
    // As Node and Chain take least sizes from the memory: a component's box wherever it applies,
    // and the largest size reached for any other node not inside a component's box.
    const kinds = new Map<ModelElement, Kind>();
    const collections = new Map<string, Set<string>>();
    const classify = (element: ModelElement, insideBox: boolean) => {
      const classes = classesOf(element);
      const id = element.attributes['data-sv-node'];
      let inside = insideBox;
      if (classes.includes('sv-node')) {
        const component = element.attributes['data-sv-component'];
        const box = component ? memory.components.get(component) : undefined;
        if (box) kinds.set(element, { kind: 'boxed', size: box });
        else if (!insideBox && id) kinds.set(element, { kind: 'reserved', key: `n:${id}`, id });
        inside ||= box !== undefined;
      } else if (classes.includes('sv-chain') && !insideBox && id)
        kinds.set(element, { kind: 'reserved', key: `n:${id}`, id });
      else if (classes.includes('sv-grid') && !insideBox && element.attributes['data-sv-grid']) {
        const grid = element.attributes['data-sv-grid'];
        kinds.set(element, { kind: 'grid', key: `g:${grid}`, id: grid });
      } else if (classes.includes('sv-arranged')) {
        const props = JSON.parse(element.attributes['data-sv-arrange'] ?? '{}') as ArrangementProps;
        kinds.set(element, { kind: 'arranged', key: `a:${props.scope}`, props });
      }
      const collection = element.attributes['data-sv-collection'];
      if (collection) {
        const items = collections.get(collection) ?? new Set<string>();
        for (const child of elementsOf(element))
          if (child.attributes['data-sv-node']) items.add(child.attributes['data-sv-node']);
        collections.set(collection, items);
      }
      for (const child of elementsOf(element)) classify(child, inside);
    };
    classify(flow, false);
    return { drawing, flow, frame, styled, parents, kinds, collections };
  }

  // A free layout's size where it was solved alone: a drawing only making room may hold one no
  // step records.
  const alone = new Map<ModelElement, Size>();
  const leastOf = (at: Read, element: ModelElement): Size | undefined => {
    const kind = at.kinds.get(element);
    if (kind?.kind === 'boxed') return kind.size;
    if (kind?.kind === 'reserved') return memory.reserved.get(kind.id);
    return undefined;
  };
  const arrangedSize = (at: Read, element: ModelElement): Size | undefined => {
    const kind = at.kinds.get(element);
    if (kind?.kind !== 'arranged') return undefined;
    const span = memory.scopes.get(kind.props.scope)?.span;
    return span ? { width: span.width, height: span.height } : alone.get(element);
  };
  // A grid keeps the tracks worked out over every step, which the markup drawn for sizing lacks.
  const gridTracks = (at: Read, element: ModelElement) => {
    const kind = at.kinds.get(element);
    return kind?.kind === 'grid' ? memory.tracks.get(kind.id) : undefined;
  };
  const tracksTag = (at: Read, element: ModelElement) => {
    const tracks = gridTracks(at, element);
    return tracks ? `#${tracks.columns.join(',')}/${tracks.rows.join(',')}` : '';
  };

  let layouts = 0;
  /**
   * An element laid out on its own, with the sizes inside it kept, and its own least size unless
   * only its content's size is wanted.
   */
  function layOutAlone(at: Read, root: ModelElement, ownLeast = false): ModelLayout {
    layouts++;
    return layOut(root, {
      rules,
      measure,
      devicePixelRatio,
      styled: at.styled,
      least: (element) => (element === root && !ownLeast ? undefined : leastOf(at, element)),
      adjust: (element): Partial<Look> | undefined => {
        const size = arrangedSize(at, element);
        if (size)
          return { width: { px: size.width, percent: 0 }, height: { px: size.height, percent: 0 } };
        const tracks = gridTracks(at, element);
        if (tracks) return { gridTemplateColumns: tracks.columns, gridTemplateRows: tracks.rows };
        const room = roomOf(at, element);
        const own = at.styled.get(element)?.look.padding;
        return (
          room &&
          own && {
            padding: [
              own[0] + room.top,
              own[1] + room.right,
              own[2] + room.bottom,
              own[3] + room.left
            ]
          }
        );
      }
    });
  }

  // A row or column holding links keeps room for what they draw past its children in its padding
  // (see node/overlay.ts), worked out once for all alike; while it is, it is laid out without it.
  const rooms = new Map<string, Sides>();
  const rooming = new Set<ModelElement>();
  function roomOf(at: Read, host: ModelElement): Sides | undefined {
    if (host.attributes['data-sv-overlaid'] === undefined || rooming.has(host)) return undefined;
    const key = wholeSignature(at, host);
    let room = rooms.get(key);
    if (!room) {
      rooming.add(host);
      const model = layOutAlone(at, host);
      const axis = classesOf(host).includes('row') ? 'row' : 'column';
      const { children, reached } = routeOverlay(layoutReader(at, model), host, axis);
      rooming.delete(host);
      const [top, right, bottom, left] = at.styled.get(host)?.look.padding ?? [0, 0, 0, 0];
      room = overlayRoom(children, reached, { top, right, bottom, left });
      rooms.set(key, room);
    }
    return room;
  }
  /** What sets an element's room apart, for a row or column holding links. */
  const roomTag = (at: Read, element: ModelElement) => {
    const room = roomOf(at, element);
    return room ? `~${room.top},${room.right},${room.bottom},${room.left}` : '';
  };

  /** Elements read from one layout of them. */
  function layoutReader(at: Read, model: ModelLayout): Reader<ModelElement> {
    const boxOf = (element: ModelElement) =>
      model.boxes.get(element) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      attribute: (element, name) => element.attributes[name],
      children: (element) => elementsOf(element).filter((child) => child.tag !== 'svg'),
      parent: (element) => at.parents.get(element),
      boxIn(inner, outer) {
        const a = boxOf(inner);
        const b = boxOf(outer);
        return { x: a.x - b.x, y: a.y - b.y, width: a.width, height: a.height };
      },
      // Whole pixels, as offsetWidth and offsetHeight round.
      size(element) {
        const { width, height } = boxOf(element);
        return { width: Math.round(width), height: Math.round(height) };
      },
      fontSize: (element) => at.styled.get(element)?.look.fontSize ?? 16
    };
  }

  // Everything a free layout's child is read by: its attributes too, as keys and ends, and the
  // sizes it and the nodes inside it keep.
  const wholeSignatures = new WeakMap<ModelElement, string>();
  function wholeSignature(at: Read, element: ModelElement): string {
    let known = wholeSignatures.get(element);
    if (known !== undefined) return known;
    const size = leastOf(at, element) ?? arrangedSize(at, element);
    known = `${idOf(at.styled.get(element))}${tracksTag(at, element)}${size ? `@${size.width}x${size.height}` : ''}${JSON.stringify(element.attributes)}(`;
    for (const child of element.children)
      known += isElement(child)
        ? wholeSignature(at, child) + roomTag(at, child)
        : JSON.stringify(child);
    known += ')';
    wholeSignatures.set(element, known);
    return known;
  }
  // Free layouts' children laid out on their own, once for all children alike, with the element
  // each element stands for in the one laid out.
  const children = new Map<string, { root: ModelElement; model: ModelLayout }>();
  const standsFor = new WeakMap<ModelElement, ModelElement>();
  const pair = (element: ModelElement, laid: ModelElement) => {
    standsFor.set(element, laid);
    const mine = elementsOf(element);
    const theirs = elementsOf(laid);
    mine.forEach((child, index) => pair(child, theirs[index]));
  };

  /**
   * A free layout's host read as Arranged reads it mounted: each child laid out on its own at the
   * size it keeps, as children are placed out of flow, at their natural size, wherever they go.
   */
  function hostReader(at: Read, host: ModelElement): Reader<ModelElement> {
    // The host's child an element is in.
    const childOf = (element: ModelElement) => {
      let child = element;
      for (let up = at.parents.get(child); up && up !== host; up = at.parents.get(child))
        child = up;
      return child;
    };
    const boxOf = (element: ModelElement) => {
      const child = childOf(element);
      const key = wholeSignature(at, child);
      let laid = children.get(key);
      if (!laid) children.set(key, (laid = { root: child, model: layOutAlone(at, child, true) }));
      if (laid.root !== child && !standsFor.has(child)) pair(child, laid.root);
      const own = laid.root === child ? element : (standsFor.get(element) ?? element);
      return laid.model.boxes.get(own) ?? { x: 0, y: 0, width: 0, height: 0 };
    };
    return {
      attribute: (element, name) => element.attributes[name],
      children: (element) => elementsOf(element).filter((child) => child.tag !== 'svg'),
      parent: (element) => at.parents.get(element),
      boxIn(inner, outer) {
        const a = boxOf(inner);
        const b = boxOf(outer);
        return { x: a.x - b.x, y: a.y - b.y, width: a.width, height: a.height };
      },
      // Whole pixels, as offsetWidth and offsetHeight round.
      size(element) {
        const { width, height } = boxOf(element);
        return { width: Math.round(width), height: Math.round(height) };
      },
      fontSize: (element) => at.styled.get(element)?.look.fontSize ?? 16
    };
  }

  // What an element's own size follows from: its look and its parents' (by the looks shared between
  // elements alike), its text, and each element inside it, or, for one keeping a least size or
  // laid out freely, only its look and its size, which holds whatever it draws.
  const signatures = new WeakMap<ModelElement, string>();
  function signature(at: Read, element: ModelElement): string {
    let known = signatures.get(element);
    if (known !== undefined) return known;
    let text = `${idOf(at.styled.get(element))}${tracksTag(at, element)}(`;
    for (const child of element.children) {
      if (!isElement(child)) {
        text += JSON.stringify(child);
        continue;
      }
      const size = leastOf(at, child) ?? arrangedSize(at, child);
      text += size
        ? `[${idOf(at.styled.get(child))}:${size.width}x${size.height}]`
        : signature(at, child) + roomTag(at, child);
    }
    known = `${text})`;
    signatures.set(element, known);
    return known;
  }
  const extents = new Map<string, Size>();
  /** An element's own size laid out on its own, to the 64th; once for all elements alike. */
  function extentAlone(at: Read, element: ModelElement): Size {
    const key = signature(at, element) + roomTag(at, element);
    let extent = extents.get(key);
    if (!extent) {
      const box = layOutAlone(at, element).boxes.get(element);
      extent = { width: box?.width ?? 0, height: box?.height ?? 0 };
      extents.set(key, extent);
    }
    return extent;
  }
  /** An element's own size laid out on its own, in whole pixels. */
  function sizeAlone(at: Read, element: ModelElement): Size {
    const { width, height } = extentAlone(at, element);
    return { width: Math.round(width), height: Math.round(height) };
  }

  return {
    read,
    leastOf,
    arrangedSize,
    alone,
    layOutAlone,
    layoutReader,
    hostReader,
    extentAlone,
    sizeAlone,
    layouts: () => layouts
  };
}

/**
 * Size a typed component from markup drawing it for its cases (see probeMarkup in
 * components.server.ts): the largest box any of its roots reaches, rounded up to whole pixels, so
 * it is never smaller than what it holds, over the box it already keeps;
 * and the font its values are drawn in. A root holding a free layout is sized by the layout's
 * solution, which drawing its cases does not give, so it is left out.
 */
export function probeComponent(
  markup: ModelElement,
  name: string,
  options: ReserveOptions
): { box?: Size; font?: string } {
  const model = sizer(options);
  const at = model.read({ markup });
  if (!at) return {};
  let box = options.memory.components.get(name);
  let font: string | undefined;
  const holdsArrangement = (element: ModelElement): boolean =>
    classesOf(element).includes('sv-arranged') || elementsOf(element).some(holdsArrangement);
  const visit = (element: ModelElement) => {
    if (element.attributes['data-sv-component'] === name && !holdsArrangement(element)) {
      // Not a pixel more: a box an odd number of pixels taller than its line puts the baseline on
      // a half pixel, and the browser draws text on a whole one, half a pixel off centre.
      const size = model.extentAlone(at, element);
      box = {
        width: Math.max(box?.width ?? 0, Math.ceil(size.width)),
        height: Math.max(box?.height ?? 0, Math.ceil(size.height))
      };
      const value = find(element, 'value');
      const look = value && at.styled.get(value)?.look;
      if (look)
        font ??= `${look.fontStyle} ${look.fontWeight} ${look.fontSize}px ${look.fontFamily}`;
    }
    for (const child of elementsOf(element)) visit(child);
  };
  visit(at.flow);
  return { ...(box ? { box } : {}), ...(font ? { font } : {}) };
}

/**
 * Work out the layout memory from every step's markup: each node's least size, each free layout's
 * solution over every step, and the fit each step needs (see Frame.svelte).
 */
export function reserveSizes(drawings: readonly Drawing[], options: ReserveOptions): Reservation {
  const { memory } = options;
  const model = sizer(options);
  const reads = drawings.flatMap((drawing) => model.read(drawing) ?? []);

  // Each sized thing's level: one more than the most of those inside it, so everything inside a
  // node or a free layout has its size before it is laid out.
  const inside = new Map<string, Set<string>>();
  const instances = new Map<string, { at: Read; element: ModelElement }[]>();
  for (const at of reads)
    for (const [element, kind] of at.kinds) {
      if (kind.kind === 'boxed') continue;
      instances.set(kind.key, [...(instances.get(kind.key) ?? []), { at, element }]);
      const held = inside.get(kind.key) ?? new Set<string>();
      const walk = (parent: ModelElement) => {
        for (const child of elementsOf(parent)) {
          const own = at.kinds.get(child);
          if (own && own.kind !== 'boxed') held.add(own.key);
          else walk(child);
        }
      };
      walk(element);
      inside.set(kind.key, held);
    }
  const levels = new Map<string, number>();
  const levelOf = (key: string, visiting = new Set<string>()): number => {
    const known = levels.get(key);
    if (known !== undefined) return known;
    visiting.add(key);
    let level = 0;
    for (const held of inside.get(key) ?? [])
      if (!visiting.has(held)) level = Math.max(level, levelOf(held, visiting) + 1);
    visiting.delete(key);
    levels.set(key, level);
    return level;
  };
  const byLevel = [...instances.keys()].sort((a, b) => levelOf(a) - levelOf(b));

  const collections = new Map<string, Set<string>>();
  for (const at of reads)
    for (const [collection, items] of at.collections)
      collections.set(collection, new Set([...(collections.get(collection) ?? []), ...items]));

  for (let start = 0; start < byLevel.length; ) {
    const level = levelOf(byLevel[start]);
    let end = start;
    while (end < byLevel.length && levelOf(byLevel[end]) === level) end++;
    const keys = byLevel.slice(start, end);
    start = end;
    // Free layouts first, each solved over every step it is recorded at.
    for (const key of keys.filter((each) => each.startsWith('a:'))) {
      const scope = key.slice(2);
      const entry = memory.scopes.get(scope) ?? { inputs: new Map() };
      memory.scopes.set(scope, entry);
      for (const { at, element } of instances.get(key) ?? []) {
        const host = elementsOf(element).find((child) => classesOf(child).includes('placed'));
        const kind = at.kinds.get(element);
        if (!host || kind?.kind !== 'arranged') continue;
        const read = model.hostReader(at, host);
        const { step } = at.drawing;
        if (step !== undefined)
          entry.inputs.set(step, arrangementInput(read, host, kind.props).input);
        else if (!entry.inputs.size) {
          const solved = arrangeChildren(read, host, kind.props, undefined);
          model.alone.set(element, { width: solved.width, height: solved.height });
        }
      }
      if (entry.inputs.size) solveRecorded(entry);
    }
    // Then the grids, each column as wide as the widest cell it holds at any step and each row as
    // tall as the tallest, as many as the largest coordinate any step uses.
    for (const key of keys.filter((each) => each.startsWith('g:'))) {
      const columns: number[] = [];
      const rows: number[] = [];
      for (const { at, element } of instances.get(key) ?? [])
        for (const cell of elementsOf(element)) {
          const row = Number(cell.attributes['data-sv-row']);
          const column = Number(cell.attributes['data-sv-col']);
          if (!Number.isInteger(row) || !Number.isInteger(column)) continue;
          const { width, height } = model.sizeAlone(at, cell);
          columns[column] = Math.max(columns[column] ?? 0, width);
          rows[row] = Math.max(rows[row] ?? 0, height);
        }
      memory.tracks.set(key.slice(2), {
        columns: Array.from(columns, (width) => width ?? 0),
        rows: Array.from(rows, (height) => height ?? 0)
      });
    }
    // Then the nodes, each keeping the largest size it reaches.
    for (const key of keys.filter((each) => each.startsWith('n:'))) {
      const id = key.slice(2);
      for (const { at, element } of instances.get(key) ?? []) {
        const { width, height } = model.sizeAlone(at, element);
        const kept = memory.reserved.get(id);
        memory.reserved.set(id, {
          width: Math.max(kept?.width ?? 0, width),
          height: Math.max(kept?.height ?? 0, height)
        });
      }
    }
    // A collection's items all keep the largest size any of them reaches: an item's own largest
    // depends on the steps it took part in, and items of different sizes would not line up.
    for (const items of collections.values()) {
      const kept = [...items].flatMap((id) => memory.reserved.get(id) ?? []);
      if (!kept.length) continue;
      const largest = {
        width: Math.max(...kept.map((size) => size.width)),
        height: Math.max(...kept.map((size) => size.height))
      };
      for (const id of items) memory.reserved.set(id, largest);
    }
  }

  // The fit each step needs, from its root's content (see Frame.svelte).
  for (const at of reads) {
    const { step } = at.drawing;
    const frame = at.styled.get(at.frame)?.look;
    if (step === undefined || !frame) continue;
    if (typeof frame.width !== 'object' || typeof frame.height !== 'object') continue;
    const insideFrame = {
      width: frame.width.px - frame.border[1] - frame.border[3] - 2 * frame.padding[3],
      height: frame.height.px - frame.border[0] - frame.border[2] - 2 * frame.padding[0]
    };
    const sizeOf = (child: ModelElement) =>
      model.leastOf(at, child) ?? model.arrangedSize(at, child) ?? model.sizeAlone(at, child);
    const content = flowExtent(
      elementsOf(at.flow).map(sizeOf),
      at.styled.get(at.flow)?.look.rowGap ?? 0,
      at.flow.style['flex-direction'] === 'row'
    );
    memory.fits.set(step, neededFit(insideFrame, content));
    if (memory.extents) {
      // The parts of the layout's root node, or of the frame where it holds more than one.
      const roots = elementsOf(at.flow);
      const holder = roots.length === 1 ? roots[0] : at.flow;
      memory.extents.set(step, {
        frame: { width: frame.width.px, height: frame.height.px },
        inside: insideFrame,
        content,
        parts: elementsOf(holder).map(sizeOf),
        row: (at.styled.get(holder)?.look.flexDirection ?? holder.style['flex-direction']) === 'row'
      });
    }
  }

  const keysOf = (prefix: string) => [...instances.keys()].filter((key) => key.startsWith(prefix));
  return {
    components: new Set(
      reads.flatMap((at) =>
        [...at.kinds].flatMap(([element, kind]) =>
          kind.kind === 'boxed' ? [element.attributes['data-sv-component']] : []
        )
      )
    ).size,
    nodes: keysOf('n:').reduce<Record<string, number>>((counts, key) => {
      const [{ element }] = instances.get(key) ?? [];
      const kind = element?.attributes['data-sv-kind'] ?? 'node';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {}),
    arrangements: keysOf('a:').length,
    layouts: model.layouts()
  };
}

/**
 * Markup with each pair of links joined both ways at the same steps drawn as one line, as Link draws
 * it once the memory holds the pair (see node/lines.ts): the link from the end first in order draws
 * it, undirected, and the other link and its label draw nothing.
 */
export function withLines(element: ModelElement, lines: ReadonlySet<string>): ModelElement {
  if (!lines.size) return element;
  const back = new Set<string>();
  let changed = false;
  const children: ModelElement['children'][number][] = [];
  for (const child of element.children) {
    if (!isElement(child)) {
      children.push(child);
      continue;
    }
    const pair = child.attributes['data-sv-pair'];
    const link = child.attributes['data-sv-link'];
    const label = child.attributes['data-sv-link-label'];
    if (link !== undefined && pair !== undefined && lines.has(pair)) {
      changed = true;
      if (child.attributes['data-sv-way'] === 'back') back.add(link);
      else
        children.push({ ...child, attributes: { ...child.attributes, 'data-directed': 'false' } });
    } else if (label !== undefined && back.delete(label)) changed = true;
    else {
      const drawn = withLines(child, lines);
      changed ||= drawn !== child;
      children.push(drawn);
    }
  }
  return changed ? { ...element, children } : element;
}

/** Every element at or under one, depth first. */
export function* elementsUnder(element: ModelElement): Generator<ModelElement> {
  yield element;
  for (const child of elementsOf(element)) yield* elementsUnder(child);
}

/**
 * What a step draws, laid out as it is shown, as text: every element seen, with its font, paint and
 * text, and the box of each that shows one (seenBox); each free layout's children where its
 * solution places them with the links it draws; and the links a row or column routes over its
 * children. Only what is seen and the room it keeps itself count: laid out without what is hidden,
 * as a node keeping its room until it shows, and without the room kept in what shows no box, and
 * placed from the top left of what is seen, so room kept for what does not show moves nothing.
 * Ids, which tell nothing about the picture, are left out too, so two presentations drawing the
 * same picture describe it alike (see drawnText).
 */
export function describeDrawn(markup: ModelElement, options: ReserveOptions): string | undefined {
  const shown = seenOnly(markup);
  const seen = [...elementsUnder(shown)].filter((element) => seenBox(element, ownText(element)));
  const kept = (attribute: string) =>
    new Set(seen.flatMap(({ attributes }) => attributes[attribute] ?? []));
  const nodes = kept('data-sv-node');
  const components = kept('data-sv-component');
  const { memory } = options;
  const model = sizer({
    ...options,
    memory: {
      ...memory,
      reserved: new Map([...memory.reserved].filter(([id]) => nodes.has(id))),
      components: new Map([...memory.components].filter(([name]) => components.has(name)))
    }
  });
  const at = model.read({ markup: shown });
  if (!at) return undefined;
  const laid = model.layOutAlone(at, at.frame, true);
  // Each part, given where what is seen starts, and the place of each box seen, which it starts at.
  const parts: { seen?: [number, number]; value: (origin: [number, number]) => unknown }[] = [];
  const placed = (
    left: number,
    top: number,
    value: (place: [number, number]) => unknown,
    seen = true
  ): (typeof parts)[number] => ({
    ...(seen ? { seen: [left, top] as [number, number] } : {}),
    value: ([originLeft, originTop]) => value([left - originLeft, top - originTop])
  });
  const walk = (
    element: ModelElement,
    boxIn: (inner: ModelElement) => Box,
    x: number,
    y: number,
    hiddenAbove = false
  ) => {
    const { attributes } = element;
    if (attributes['data-sv-link'] !== undefined || attributes['data-sv-link-label'] !== undefined)
      return;
    const look = at.styled.get(element)?.look;
    if (look?.display === 'none') return;
    // Hidden as the page hides it (page.ts): inherited, unless shown again inside.
    const hiddenAs = attributes['data-sv-hidden'] ?? element.style.visibility;
    const hidden =
      hiddenAs === 'true' || hiddenAs === 'hidden' || (hiddenAbove && !isShown(hiddenAs));
    const box = boxIn(element);
    const left = box.x + x;
    const top = box.y + y;
    const text = ownText(element);
    if (!hidden) {
      const [tag, ...rest] = [
        element.tag,
        look && [look.fontSize, look.fontWeight, look.fontStyle, look.fontFamily, look.border],
        look && [look.textTransform, look.fontVariantCaps],
        Object.entries(element.style).filter(([name]) => paintProperties.has(name)),
        Object.entries(attributes).filter(([name]) => !unseenAttributes.has(name)),
        text
      ];
      parts.push(
        seenBox(element, text)
          ? placed(left, top, (place) => [tag, [...place, box.width, box.height], ...rest])
          : { value: () => [tag, ...rest] }
      );
    }
    if (attributes['data-sv-overlaid'] !== undefined) {
      const axis = classesOf(element).includes('row') ? 'row' : 'column';
      const route = routeOverlay(model.layoutReader(at, laid), element, axis);
      parts.push(placed(left, top, (place) => ['links', place, route.lines], false));
      for (const { label, middle } of route.labels)
        walk(
          label,
          (inner) => model.layoutReader(at, laid).boxIn(inner, label),
          left + middle.x,
          top + middle.y,
          hidden
        );
    }
    const host = classesOf(element).includes('sv-arranged')
      ? elementsOf(element).find((child) => classesOf(child).includes('placed'))
      : undefined;
    if (!host) {
      for (const child of elementsOf(element)) walk(child, boxIn, x, y, hidden);
      return;
    }
    // Placed as the page places them (see Arranged.svelte), each child laid out on its own.
    const props = JSON.parse(attributes['data-sv-arrange'] ?? '{}') as ArrangementProps;
    const read = model.hostReader(at, host);
    const arranged = arrangeChildren(read, host, props, options.memory);
    const hostBox = boxIn(host);
    const hostLeft = hostBox.x + x;
    const hostTop = hostBox.y + y;
    parts.push({
      value: () => ['arranged', [arranged.width, arranged.height], arranged.edges, arranged.styles]
    });
    arranged.elements.forEach((child, index) => {
      const { x: placedX, y: placedY } = arranged.placements[index];
      walk(
        child,
        (inner) => read.boxIn(inner, child),
        hostLeft + placedX,
        hostTop + placedY,
        hidden
      );
    });
    for (const edge of arranged.edges) {
      const label = edge.id === undefined ? undefined : arranged.labels.get(edge.id);
      if (label)
        walk(
          label,
          (inner) => read.boxIn(inner, label),
          hostLeft + edge.middle.x,
          hostTop + edge.middle.y,
          hidden
        );
    }
  };
  walk(at.frame, (element) => laid.boxes.get(element) ?? { x: 0, y: 0, width: 0, height: 0 }, 0, 0);
  const places = parts.flatMap(({ seen }) => (seen ? [seen] : []));
  const origin: [number, number] = places.length
    ? [Math.min(...places.map(([left]) => left)), Math.min(...places.map(([, top]) => top))]
    : [0, 0];
  return parts.map(({ value }) => drawnText(value(origin))).join('\n');
}

function ownText(element: ModelElement): string {
  return element.children.filter((child) => !isElement(child)).join('');
}

/**
 * Whether an element shows its box, which its size and place are then seen by: one not a plain
 * block or span, as an svg; one with text of its own; or one that paints a box, as Node does in
 * its inline style: a fill, a stroke or a shadow. Any other only holds what is inside it.
 */
function seenBox(element: ModelElement, text: string): boolean {
  if (element.tag !== 'div' && element.tag !== 'span') return true;
  if (text.trim() || element.attributes['data-sv-framed'] !== undefined) return true;
  const { style } = element;
  return (
    (parseFloat(style['border-width'] ?? '') > 0 && style['border-style'] !== 'none') ||
    !unpainted(style['background-color']) ||
    !unpainted(style['background-image']) ||
    !unpainted(style['box-shadow'])
  );
}

/**
 * Markup as far as it is seen: without what the page hides (page.ts), as a node keeping its room
 * until it shows, unless something inside it shows again; and without the room a node showing no
 * box keeps, the largest size it reaches (Node's least size in pixels), keeping its own least size.
 */
function seenOnly(element: ModelElement): ModelElement {
  if (hiddenHere(element) && !showsInside(element))
    return { ...element, style: { ...element.style, display: 'none' } };
  let changed = false;
  const children = element.children.map((child) => {
    if (!isElement(child)) return child;
    const drawn = seenOnly(child);
    changed ||= drawn !== child;
    return drawn;
  });
  const style =
    classesOf(element).includes('sv-node') && !seenBox(element, ownText(element))
      ? withoutKeptRoom(element.style)
      : element.style;
  return changed || style !== element.style ? { ...element, style, children } : element;
}

/** A style without the pixels of a least size, keeping a least size in other units. */
function withoutKeptRoom(style: ModelElement['style']): ModelElement['style'] {
  const least = (value: string | undefined) =>
    value === undefined || !/\dpx/u.test(value)
      ? value
      : /^max\((.*),\s*[\d.]+px\)$/u.exec(value)?.[1]?.trim();
  const kept = Object.entries(style).flatMap(([property, value]) => {
    if (property !== 'min-width' && property !== 'min-height') return [[property, value]];
    const own = least(value);
    return own === undefined ? [] : [[property, own]];
  });
  return kept.length === Object.keys(style).length &&
    kept.every(([property, value]) => style[property] === value)
    ? style
    : Object.fromEntries(kept);
}

function hiddenHere(element: ModelElement): boolean {
  const hiddenAs = element.attributes['data-sv-hidden'] ?? element.style.visibility;
  return hiddenAs === 'true' || hiddenAs === 'hidden';
}

function showsInside(element: ModelElement): boolean {
  return elementsOf(element).some(
    (child) =>
      isShown(child.attributes['data-sv-hidden'] ?? child.style.visibility) || showsInside(child)
  );
}

function unpainted(value: string | undefined): boolean {
  return (
    value === undefined || ['', 'none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(value.trim())
  );
}

/** Whether an element shows again inside a hidden one, as the page shows it (page.ts). */
function isShown(hiddenAs: string | undefined): boolean {
  return hiddenAs === 'false' || hiddenAs === 'visible';
}

/** Inline declarations that paint, rather than size or place, what an element draws. */
const paintProperties = new Set([
  'color',
  'background-color',
  'background-image',
  'box-shadow',
  'border-color',
  'border-style',
  'border-radius',
  'opacity',
  'visibility',
  'text-decoration-line',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray'
]);

/**
 * Attributes that tell nothing drawn: the inline style, read for its paint; ids, which differ
 * between builds drawing alike; and a free layout's props, drawn as its children's places.
 */
const unseenAttributes = new Set([
  'style',
  'id',
  'data-sv-node',
  'data-sv-identity',
  'data-sv-slot',
  'data-sv-item',
  'data-sv-around',
  'data-sv-pair',
  'data-sv-way',
  'data-sv-ref',
  'data-sv-component',
  'data-sv-collection',
  'data-sv-arrange',
  'data-from',
  'data-to'
]);

/**
 * A value as text, ids and links' ends as written left out: numbers in whole pixels, so what moves
 * by less than one is not seen, and numbers within text, as a path's or an opacity, to hundredths.
 */
export function drawnText(value: unknown): string {
  return JSON.stringify(value, (key, inner: unknown) => {
    if (key === 'id' || key === 'link' || key === 'key') return undefined;
    if (typeof inner === 'number') return Math.round(inner);
    if (typeof inner === 'string')
      return inner.replace(/-?\d*\.\d+/gu, (number) =>
        String(Math.round(Number(number) * 100) / 100)
      );
    return inner;
  });
}
