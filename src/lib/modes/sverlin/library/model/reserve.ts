/**
 * The layout memory worked out on the layout model from steps' markup, as Svelte's string renderer
 * writes it, before any step is mounted (see LayoutMemory). Sizes compose bottom up:
 *
 * - a typed component's root keeps its component's box, the largest it draws over the values of
 *   its parameters (see components.server.ts), one fixed box wherever it is used;
 * - any other node keeps the largest size it reaches at any step, laid out with the sizes the nodes
 *   inside it keep, so it holds them at every step;
 * - the items of a collection all keep the largest any of them reaches;
 * - a free layout is solved once over every step from its children's sizes (see node/span.ts), and
 *   the node holding it is sized with it at that size.
 *
 * Each node is laid out on its own, and nodes alike, by their looks, their text and the sizes
 * inside them, only once: a node holding the same values at many steps costs one layout.
 */

import { flowExtent, neededFit } from '../fit';
import {
  arrangeChildren,
  arrangementInput,
  recordArrangement,
  type ArrangementProps
} from '../node/arrangement';
import type { Reader } from '../node/reader';
import { solveSpan, type SpanInput } from '../node/span';
import type { LayoutMemory } from '../type-context';
import type { Rule } from './css';
import { layOut, type ModelLayout, type TextMeasure } from './layout';
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
  /** Nodes keeping the largest size they reach over the steps, and free layouts solved. */
  nodes: number;
  arrangements: number;
  /** Elements laid out on the model, each laid out once for all those alike. */
  layouts: number;
};

type Kind =
  | { kind: 'boxed'; size: Size }
  | { kind: 'reserved'; key: string; id: string }
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
      else if (classes.includes('sv-arranged')) {
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
        return (
          size && { width: { px: size.width, percent: 0 }, height: { px: size.height, percent: 0 } }
        );
      }
    });
  }

  // Everything a free layout's child is read by: its attributes too, as keys and ends, and the
  // sizes it and the nodes inside it keep.
  const wholeSignatures = new WeakMap<ModelElement, string>();
  function wholeSignature(at: Read, element: ModelElement): string {
    let known = wholeSignatures.get(element);
    if (known !== undefined) return known;
    const size = leastOf(at, element) ?? arrangedSize(at, element);
    known = `${idOf(at.styled.get(element))}${size ? `@${size.width}x${size.height}` : ''}${JSON.stringify(element.attributes)}(`;
    for (const child of element.children)
      known += isElement(child) ? wholeSignature(at, child) : JSON.stringify(child);
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
    let text = `${idOf(at.styled.get(element))}(`;
    for (const child of element.children) {
      if (!isElement(child)) {
        text += JSON.stringify(child);
        continue;
      }
      const size = leastOf(at, child) ?? arrangedSize(at, child);
      text += size
        ? `[${idOf(at.styled.get(child))}:${size.width}x${size.height}]`
        : signature(at, child);
    }
    known = `${text})`;
    signatures.set(element, known);
    return known;
  }
  const sizes = new Map<string, Size>();
  /** An element's own size laid out on its own, in whole pixels; once for all elements alike. */
  function sizeAlone(at: Read, element: ModelElement): Size {
    const key = signature(at, element);
    let size = sizes.get(key);
    if (!size) {
      const box = layOutAlone(at, element).boxes.get(element);
      size = { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
      sizes.set(key, size);
    }
    return size;
  }

  return {
    read,
    leastOf,
    arrangedSize,
    alone,
    layOutAlone,
    hostReader,
    sizeAlone,
    layouts: () => layouts
  };
}

/**
 * Size a typed component from markup drawing it for its cases (see probeMarkup in
 * components.server.ts): the largest box any of its roots reaches, a pixel more than the whole
 * pixels it rounds to, so it is never smaller than what it holds, over the box it already keeps;
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
      const size = model.sizeAlone(at, element);
      box = {
        width: Math.max(box?.width ?? 0, size.width + 1),
        height: Math.max(box?.height ?? 0, size.height + 1)
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
      for (const { at, element } of instances.get(key) ?? []) {
        const host = elementsOf(element).find((child) => classesOf(child).includes('placed'));
        const kind = at.kinds.get(element);
        if (!host || kind?.kind !== 'arranged') continue;
        const read = model.hostReader(at, host);
        const { step } = at.drawing;
        if (step !== undefined)
          recordArrangement(
            { ...memory, step },
            scope,
            arrangementInput(read, host, kind.props).input
          );
        else if (!memory.scopes.get(scope)?.inputs.size) {
          const solved = arrangeChildren(read, host, kind.props, undefined);
          model.alone.set(element, { width: solved.width, height: solved.height });
        }
      }
      const entry = memory.scopes.get(scope);
      if (entry?.inputs.size) {
        const steps = [...entry.inputs.keys()].sort((a, b) => a - b);
        entry.span = solveSpan(steps.map((step) => entry.inputs.get(step) as SpanInput));
      }
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
    const content = flowExtent(
      elementsOf(at.flow).map(
        (child) =>
          model.leastOf(at, child) ?? model.arrangedSize(at, child) ?? model.sizeAlone(at, child)
      ),
      at.styled.get(at.flow)?.look.rowGap ?? 0,
      at.flow.style['flex-direction'] === 'row'
    );
    memory.fits.set(step, neededFit(insideFrame, content));
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
    nodes: keysOf('n:').length,
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
