/**
 * The layout model: every element's box worked out from a step's markup (see tree.ts), the
 * library's style sheets (see css.ts, look.ts) and text widths, with nothing read from a laid-out
 * page. It lays out what views draw, as the browser does, to its 64ths of a pixel: blocks stacked,
 * flex rows and columns on one line, grids of one column, of equal tracks, or of items placed by
 * line, lines of text with views inside them, and boxes placed out of flow. What it does not model
 * it refuses, naming it in `problems`, rather than guessing.
 */

import type { Rule } from './css';
import { lookOf, type Length, type Look, type Styled, type Styler } from './look';
import { casedRuns, caseOf, smallCapsSize } from './text-case';
import { isElement, type ModelElement } from './tree';

/** Text widths and font metrics, as the page's canvas gives them (see text.ts). */
export type TextMeasure = {
  /** The advance of a run of text in a font, in CSS pixels. */
  width(text: string, font: string): number;
  /** A font's ascent and descent, as lines use them, and its x-height. */
  metrics(font: string): { ascent: number; descent: number; xHeight: number };
};

export type Box = { x: number; y: number; width: number; height: number };

export type ModelLayout = {
  /** Each element's border box in its root's border box, in layout pixels. */
  boxes: Map<ModelElement, Box>;
  looks: Map<ModelElement, Look>;
  /** What the markup holds that the model does not lay out, so its boxes there are not exact. */
  problems: string[];
  /** The texts each element holds itself, by the element, as laid out in its line. */
  texts: Map<ModelElement, ModelText[]>;
};

/**
 * A text an element holds, its spaces collapsed as the line draws them: from the left of its first
 * character to the right of its last, the height of its font's ascent and descent, in its root's
 * border box. `index` is its place among the element's children.
 */
export type ModelText = { text: string; index: number; box: Box; look: Look };

export type ModelOptions = {
  rules: readonly Rule[];
  measure: TextMeasure;
  /** The root's ancestors, outermost first, for what they pass down; none, the root is the page's. */
  ancestors?: readonly ModelElement[];
  /** Border widths snap to device pixels. */
  devicePixelRatio?: number;
  /** Works out looks, sharing them between elements alike (see look.ts); unset, each its own. */
  styler?: Styler;
  /** Looks already worked out for the tree's elements, as by styleTree, used as they are. */
  styled?: ReadonlyMap<ModelElement, Styled>;
  /**
   * Looks changed from what the cascade gives, as a script setting inline styles would, for what
   * never changes what descendants inherit: sizes, least sizes and insets.
   */
  adjust?: (element: ModelElement) => Partial<Look> | undefined;
  /** Least sizes in pixels over those the cascade gives, as min-width: max(…, 40px) would. */
  least?: (element: ModelElement) => { width: number; height: number } | undefined;
};

type Fragment = { element: ModelElement; width: number; height: number; children: Placed[] };
type Placed = { fragment: Fragment; x: number; y: number };
type TextItem = { text: string; look: Look; owner: ModelElement; index: number };
type Content = { width: number; height: number; children: Placed[] };
type Item = TextItem | { element: ModelElement; look: Look };

const units = 64;
/** A computed length as layout takes it: a 32-bit float in 64ths of a pixel, toward zero. */
const laid = (value: number) => Math.trunc(Math.fround(value) * units) / units;
/** A text advance as layout takes it: rounded up to the next 64th. */
const advance = (value: number) => Math.ceil(value * units - 1e-6) / units;
/** Layout halves in whole 64ths, toward zero. */
const halved = (value: number) => Math.trunc((value * units) / 2) / units;
const divided = (value: number, by: number) => Math.trunc((value * units) / by) / units;

/** A look's font, as CSS writes it and the text measure takes it. */
export const fontOf = (look: Look): string =>
  `${look.fontStyle} ${look.fontWeight} ${look.fontSize}px ${look.fontFamily}`;
const inlineLevel = (display: string) => display.startsWith('inline');
const lengthPx = (length: Length) => length.px;

export function layOut(root: ModelElement, options: ModelOptions): ModelLayout {
  const { rules, measure, ancestors = [], devicePixelRatio = 1, adjust, least } = options;
  const known = options.styled;
  const lookUp: Styler =
    options.styler ??
    ((element, chain, parent) => lookOf(element, chain, parent, rules, devicePixelRatio));
  const problems = new Set<string>();
  const styled = new Map<ModelElement, Styled>();
  const looks = new Map<ModelElement, Look>();
  // Elements out of flow, by the element their position is taken from.
  const outOfFlow = new Map<ModelElement, ModelElement[]>();

  let above: Styled | undefined;
  if (!known?.has(root))
    ancestors.forEach((element, depth) => {
      above = lookUp(element, ancestors.slice(0, depth), above);
    });
  const style = (
    element: ModelElement,
    chain: ModelElement[],
    parent: Styled | undefined,
    positioned: ModelElement
  ) => {
    const own = known?.get(element) ?? lookUp(element, chain, parent);
    styled.set(element, own);
    looks.set(element, own.look);
    const { position, display } = own.look;
    if (display === 'none') return;
    if (element !== root && (position === 'absolute' || position === 'fixed')) {
      if (position === 'fixed') problems.add('position: fixed');
      outOfFlow.set(positioned, [...(outOfFlow.get(positioned) ?? []), element]);
    }
    if (element.tag === 'svg') return;
    const holds = position === 'static' && element !== root ? positioned : element;
    for (const child of element.children)
      if (isElement(child)) style(child, [...chain, element], own, holds);
  };
  style(root, [...ancestors], above, root);
  const adjusted = new Map<ModelElement, Look>();
  const lookAt = (element: ModelElement): Look => {
    let look = adjusted.get(element);
    if (!look) {
      const own = styled.get(element)?.look as Look;
      const change = adjust?.(element);
      adjusted.set(element, (look = change ? { ...own, ...change } : own));
    }
    return look;
  };

  // A box's in-flow items: text, and elements laid out in flow, with display: contents unwrapped.
  // An svg is sized by its own width and height, never by what it draws.
  const itemsOf = (element: ModelElement): Item[] =>
    (element.tag === 'svg' ? [] : element.children).flatMap((child, index): Item[] => {
      if (!isElement(child))
        return child.length ? [{ text: child, look: lookAt(element), owner: element, index }] : [];
      const look = lookAt(child);
      if (look.display === 'none' || look.position === 'absolute' || look.position === 'fixed')
        return [];
      if (look.display === 'contents') return itemsOf(child);
      return [{ element: child, look }];
    });

  const edges = (look: Look) => ({
    left: laid(look.padding[3]) + look.border[3],
    top: laid(look.padding[0]) + look.border[0],
    horizontal: laid(look.padding[1]) + laid(look.padding[3]) + look.border[1] + look.border[3],
    vertical: laid(look.padding[0]) + laid(look.padding[2]) + look.border[0] + look.border[2]
  });

  const fragments = new Map<ModelElement, Map<string, Fragment>>();
  /**
   * An element's border box and what it holds. `width` is a border-box width it is laid out at,
   * as a stretched block's; `height` one it is stretched to; unset, each is its own.
   */
  function box(element: ModelElement, width?: number, height?: number): Fragment {
    const key = `${width}|${height}`;
    const known = fragments.get(element)?.get(key);
    if (known) return known;
    const look = lookAt(element);
    const { left, top, horizontal, vertical } = edges(look);
    // A border box is never smaller than its padding and border, as at height 0.
    const toBorder = (size: number, edge: number) =>
      look.borderBox ? Math.max(size, edge) : size + edge;
    const kept = least?.(element);
    const leastWidth = toBorder(
      laid(Math.max(lengthPx(look.minWidth), kept?.width ?? 0)),
      horizontal
    );
    const leastHeight = toBorder(
      laid(Math.max(lengthPx(look.minHeight), kept?.height ?? 0)),
      vertical
    );
    if (look.minWidth.percent || look.minHeight.percent) problems.add('percentage least sizes');
    let outer: number;
    if (typeof look.width === 'object') {
      if (look.width.percent) problems.add('percentage widths in flow');
      outer = Math.max(leastWidth, toBorder(laid(look.width.px), horizontal));
    } else if (width !== undefined && look.width === 'auto') outer = Math.max(width, leastWidth);
    else outer = Math.max(leastWidth, content(element, look).width + horizontal);
    const inner = outer - horizontal;
    const natural = content(element, look, inner);
    let tall: number;
    if (typeof look.height === 'object') {
      if (look.height.percent) problems.add('percentage heights in flow');
      tall = Math.max(leastHeight, toBorder(laid(look.height.px), vertical));
    } else if (height !== undefined) tall = Math.max(height, leastHeight);
    else tall = Math.max(leastHeight, natural.height + vertical);
    const laidOut =
      tall - vertical === natural.height ? natural : content(element, look, inner, tall - vertical);
    const fragment: Fragment = {
      element,
      width: outer,
      height: tall,
      children: laidOut.children.map(({ fragment: child, x, y }) => ({
        fragment: child,
        x: x + left,
        y: y + top
      }))
    };
    if (!fragments.has(element)) fragments.set(element, new Map());
    fragments.get(element)?.set(key, fragment);
    return fragment;
  }

  /** A box's content, at a content width, or its own; and at a content height it is given. */
  function content(element: ModelElement, look: Look, width?: number, height?: number): Content {
    const items = itemsOf(element);
    const { display } = look;
    if (display === 'flex' || display === 'inline-flex') return flex(look, items, width, height);
    if (display === 'grid' || display === 'inline-grid')
      return grid(element, look, items, width, height);
    if (['block', 'inline-block', 'flow-root', 'list-item'].includes(display))
      return block(look, items, width);
    if (display === 'inline') return inline(look, items, width);
    problems.add(`display: ${display}`);
    return { width: 0, height: 0, children: [] };
  }

  // Spaces kept as written make a line of their own, as a listing's blank line has.
  const keepsSpaces = (look: Look) => ['pre', 'pre-wrap', 'break-spaces'].includes(look.whiteSpace);
  const hasInline = (items: readonly Item[]) =>
    items.some((item) =>
      'text' in item
        ? item.text.trim() || (item.text && keepsSpaces(item.look))
        : inlineLevel(item.look.display)
    );

  const margins = (look: Look) => look.margin.map((side) => (side === 'auto' ? 0 : laid(side)));

  /** A vertical-align written as a length, in px or em, as inline maths has: how far it raises. */
  const lengthAlign = (look: Look): number | undefined => {
    const length = /^(-?[\d.]+)(px|em)$/u.exec(look.verticalAlign.trim());
    if (!length) return undefined;
    const value = Number(length[1]);
    return laid(length[2] === 'em' ? value * look.fontSize : value);
  };

  function block(look: Look, items: readonly Item[], width?: number): Content {
    if (hasInline(items)) {
      if (items.some((item) => 'element' in item && !inlineLevel(item.look.display)))
        problems.add('blocks among text');
      return inline(look, items, width);
    }
    const kids = items.flatMap((item) => ('element' in item ? [item] : []));
    if (width === undefined) {
      const widest = Math.max(
        0,
        ...kids.map(({ element, look: own }) => {
          const [, right, , left] = margins(own);
          return box(element).width + left + right;
        })
      );
      return block(look, items, widest);
    }
    let y = 0;
    const children = kids.map(({ element, look: own }): Placed => {
      const [top, right, bottom, left] = margins(own);
      if (top || bottom) problems.add('vertical margins');
      const fragment = own.width === 'auto' ? box(element, width - left - right) : box(element);
      const [, autoRight, , autoLeft] = own.margin.map((side) => side === 'auto');
      const x =
        autoLeft && autoRight
          ? halved(width - fragment.width)
          : autoLeft
            ? width - fragment.width - right
            : left;
      const placed = { fragment, x, y: y + top };
      y += top + fragment.height + bottom;
      return placed;
    });
    return { width, height: y, children };
  }

  /** Where items start along an axis and the room between them, as justify-content puts them. */
  function distribute(free: number, count: number, justify: string) {
    switch (justify) {
      case 'center':
        return { start: halved(free), between: 0 };
      case 'flex-end':
      case 'end':
        return { start: free, between: 0 };
      case 'space-between':
        return free > 0 && count > 1
          ? { start: 0, between: divided(free, count - 1) }
          : { start: 0, between: 0 };
      case 'space-around':
        return free > 0
          ? { start: halved(divided(free, count)), between: divided(free, count) }
          : { start: halved(free), between: 0 };
      case 'space-evenly':
        return free > 0
          ? { start: divided(free, count + 1), between: divided(free, count + 1) }
          : { start: halved(free), between: 0 };
      default:
        return { start: 0, between: 0 };
    }
  }

  /** An item's offset in the room it has along an axis, as align or justify puts it. */
  function aligned(room: number, size: number, alignment: string): number {
    switch (alignment) {
      case 'center':
        return halved(room - size);
      case 'flex-end':
      case 'end':
      case 'self-end':
        return room - size;
      default:
        return 0;
    }
  }
  const stretches = (alignment: string) => alignment === 'normal' || alignment === 'stretch';

  function flex(look: Look, items: readonly Item[], width?: number, height?: number): Content {
    // Text is an anonymous item of its line, sized by it, which nothing stretches or narrows.
    type Kid = { element: ModelElement; look: Look; fragment?: Fragment };
    const kids = items.flatMap((item): Kid[] => {
      if ('element' in item) return [item];
      if (!item.text.trim()) return [];
      const fragment = anonymousBox(inline(look, [item]));
      return [{ element: fragment.element, look: { ...look, alignSelf: 'auto' }, fragment }];
    });
    const row = look.flexDirection.startsWith('row');
    if (look.flexDirection.endsWith('reverse')) problems.add('reversed flex boxes');
    const gap = laid(row ? look.columnGap : look.rowGap);
    const gaps = Math.max(0, kids.length - 1) * gap;
    const alignmentOf = (own: Look) => (own.alignSelf === 'auto' ? look.alignItems : own.alignSelf);
    const kidBox = (index: number, width?: number, height?: number): Fragment =>
      kids[index].fragment ?? box(kids[index].element, width, height);
    const natural = kids.map((_, index) => kidBox(index));
    if (row) {
      const sum = natural.reduce((total, fragment) => total + fragment.width, 0) + gaps;
      const outer = width ?? sum;
      if (sum > outer + 1 / units) problems.add('flex items shrinking');
      const line = height ?? Math.max(0, ...natural.map((fragment) => fragment.height));
      const { start, between } = distribute(outer - sum, kids.length, look.justifyContent);
      let x = start;
      const children = kids.map(({ look: own }, index): Placed => {
        const alignment = alignmentOf(own);
        const fragment =
          stretches(alignment) && own.height === 'auto'
            ? kidBox(index, natural[index].width, line)
            : natural[index];
        const placed = { fragment, x, y: aligned(line, fragment.height, alignment) };
        x += fragment.width + gap + between;
        return placed;
      });
      return {
        width: outer,
        height: height ?? Math.max(0, ...natural.map((fragment) => fragment.height)),
        children
      };
    }
    const outer = width ?? Math.max(0, ...natural.map((fragment) => fragment.width));
    const laidOut = kids.map(({ look: own }, index) =>
      stretches(alignmentOf(own)) && own.width === 'auto' ? kidBox(index, outer) : natural[index]
    );
    const sum = laidOut.reduce((total, fragment) => total + fragment.height, 0) + gaps;
    const tall = height ?? sum;
    const { start, between } = distribute(tall - sum, kids.length, look.justifyContent);
    let y = start;
    const children = kids.map(({ look: own }, index): Placed => {
      const fragment = laidOut[index];
      const placed = { fragment, x: aligned(outer, fragment.width, alignmentOf(own)), y };
      y += fragment.height + gap + between;
      return placed;
    });
    return { width: outer, height: tall, children };
  }

  type Axis = 'column' | 'row';
  const subgridAxis = (look: Look): Axis | undefined => {
    if (look.subgridColumns && look.subgridRows) problems.add('subgrids along both axes');
    return look.subgridColumns ? 'column' : look.subgridRows ? 'row' : undefined;
  };
  const startAlong = (look: Look, axis: Axis) =>
    axis === 'column' ? look.gridColumnStart : look.gridRowStart;
  const spanAlong = (look: Look, axis: Axis) =>
    axis === 'column' ? look.gridColumnSpan : look.gridRowSpan;
  const sizeAlong = (size: { width: number; height: number }, axis: Axis) =>
    axis === 'column' ? size.width : size.height;
  /** An element's padding and border at its start and its end along an axis. */
  const edgesAlong = (look: Look, axis: Axis) =>
    axis === 'column'
      ? [laid(look.padding[3]) + look.border[3], laid(look.padding[1]) + look.border[1]]
      : [laid(look.padding[0]) + look.border[0], laid(look.padding[2]) + look.border[2]];

  type Leaf = {
    item: { element: ModelElement; look: Look };
    line: number;
    span: number;
  };
  /**
   * A subgrid's items along its axis, with the items of subgrids inside it along the same axis, each
   * with its line from the subgrid's first track. Unlike CSS Grid 2, which adds a subgrid's padding
   * and border, and half the difference between its gap and its parent's, to its items' margins,
   * nothing moves an item off its track: the subgrid's box reaches out past its first and last
   * tracks by its padding and border instead, and its gap is its grid's (see the guide's Subgrids).
   * A subgrid with no span of its own spans the tracks its items reach.
   */
  function leavesOf(
    element: ModelElement,
    axis: Axis,
    given?: number
  ): { leaves: Leaf[]; span: number } {
    let next = 0;
    const units = itemsOf(element).flatMap((item) => {
      if (!('element' in item)) {
        if (item.text.trim()) problems.add('text in a subgrid');
        return [];
      }
      const start = startAlong(item.look, axis);
      const line = start === undefined ? next : start - 1;
      const own = spanAlong(item.look, axis);
      const inner = subgridAxis(item.look) === axis ? leavesOf(item.element, axis, own) : undefined;
      const span = inner?.span ?? own ?? 1;
      next = line + span;
      return [{ line, span, leaves: inner?.leaves ?? [{ item, line: 0, span }] }];
    });
    const span = given ?? Math.max(1, ...units.map((unit) => unit.line + unit.span));
    const leaves = units.flatMap((unit) =>
      unit.leaves.map((leaf) => ({ ...leaf, line: unit.line + leaf.line }))
    );
    return { leaves, span };
  }

  /** The tracks a subgrid takes from its parent grid along its axis: their sizes and the gap between them. */
  type GivenTracks = { axis: Axis; sizes: readonly number[]; lineGap: number };
  const givenTracks = new Map<ModelElement, GivenTracks>();
  const giveTracks = (element: ModelElement, given: GivenTracks) => {
    givenTracks.set(element, given);
    fragments.delete(element);
  };

  function grid(
    element: ModelElement,
    look: Look,
    items: readonly Item[],
    width?: number,
    height?: number
  ): Content {
    const kids = items.filter((item) => 'element' in item || item.text.trim());
    const sizeOf = (item: Item, at?: number) =>
      'element' in item ? box(item.element, at) : inline(look, [item], at);
    const justifyOf = (item: Item) =>
      'element' in item && item.look.justifySelf !== 'auto'
        ? item.look.justifySelf
        : look.justifyItems === 'legacy'
          ? 'normal'
          : look.justifyItems;
    const alignOf = (item: Item) =>
      'element' in item && item.look.alignSelf !== 'auto' ? item.look.alignSelf : look.alignItems;
    const columnGap = laid(look.columnGap);
    const rowGap = laid(look.rowGap);
    const natural = kids.map((item) => sizeOf(item));
    const widest = Math.max(0, ...natural.map((size) => size.width));
    const tallest = Math.max(0, ...natural.map((size) => size.height));
    const count = kids.length;
    /**
     * Place an item in its cell, stretching it where its alignment says; a subgrid always stretches
     * along its axis, as its tracks are its parent's.
     */
    const place = (
      index: number,
      x: number,
      y: number,
      cellWidth: number,
      cellHeight: number,
      subgrid?: Axis
    ) => {
      const item = kids[index];
      const justify = justifyOf(item);
      const align = alignOf(item);
      const stretchedWidth =
        subgrid === 'column' ||
        (stretches(justify) && !('element' in item && item.look.width !== 'auto'));
      const stretchedHeight =
        subgrid === 'row' ||
        (stretches(align) && !('element' in item && item.look.height !== 'auto'));
      // Text is an anonymous box of its line, placed as an item, so its text is placed with it.
      const fragment =
        'element' in item
          ? box(
              item.element,
              stretchedWidth ? cellWidth : natural[index].width,
              stretchedHeight ? cellHeight : undefined
            )
          : anonymousBox(natural[index]);
      const size = fragment ?? natural[index];
      // Auto margins take the room before alignment does.
      const [autoTop, autoRight, autoBottom, autoLeft] =
        'element' in item ? item.look.margin.map((side) => side === 'auto') : [];
      const inRoom = (
        room: number,
        extent: number,
        before?: boolean,
        after?: boolean,
        alignment = ''
      ) =>
        before && after
          ? halved(room - extent)
          : before
            ? room - extent
            : after
              ? 0
              : aligned(room, extent, alignment);
      return fragment
        ? [
            {
              fragment,
              x: x + inRoom(cellWidth, size.width, autoLeft, autoRight, justify),
              y: y + inRoom(cellHeight, size.height, autoTop, autoBottom, align)
            }
          ]
        : [];
    };
    const given = givenTracks.get(element);
    // A grid whose cells are all placed out of flow, as a basis places them, holds nothing in flow.
    if (!count) return { width: width ?? 0, height: height ?? 0, children: [] };
    if (
      kids.some((item) => 'element' in item && item.look.gridRowStart !== undefined) ||
      look.gridTemplateColumns.length ||
      look.gridTemplateRows.length ||
      subgridAxis(look)
    )
      return placedGrid();
    // Items placed by their lines, as a grid of rows and columns: each track as its template gives
    // it, or else as large as the largest item in it, and the room left across spread by
    // justify-content. A subgrid takes its parent's tracks along its axis (see GivenTracks), and,
    // laid out with no parent's, is a grid of its own, as in CSS.
    function placedGrid(): Content {
      if (look.gridAutoColumns !== 'max-content' || look.gridAutoRows !== 'max-content')
        problems.add(`grid-auto-columns and -rows: ${look.gridAutoColumns} ${look.gridAutoRows}`);
      // A subgrid with no span of its own spans the tracks its items reach.
      const spanOf = (item: Item, axis: Axis) => {
        if (!('element' in item)) return 1;
        const own = spanAlong(item.look, axis);
        if (own !== undefined || subgridAxis(item.look) !== axis) return own ?? 1;
        return leavesOf(item.element, axis).span;
      };
      const lines = kids.map((item) =>
        'element' in item &&
        item.look.gridRowStart !== undefined &&
        item.look.gridColumnStart !== undefined
          ? {
              row: item.look.gridRowStart - 1,
              column: item.look.gridColumnStart - 1,
              rowSpan: spanOf(item, 'row'),
              columnSpan: spanOf(item, 'column')
            }
          : undefined
      );
      if (lines.some((line) => !line)) problems.add('grid items not placed by line');
      // What each item asks of the tracks along an axis; a subgrid's items ask in its place.
      const asks = (axis: Axis) =>
        lines.flatMap((line, index) => {
          if (!line) return [];
          const item = kids[index];
          const at = axis === 'column' ? line.column : line.row;
          const span = axis === 'column' ? line.columnSpan : line.rowSpan;
          if ('element' in item && subgridAxis(item.look) === axis)
            return leavesOf(item.element, axis, span).leaves.map((leaf) => ({
              at: at + leaf.line,
              span: leaf.span,
              size: sizeAlong(box(leaf.item.element), axis)
            }));
          return [{ at, span, size: sizeAlong(natural[index], axis) }];
        });
      // Each track as its template gives it, or as large as the largest item it alone holds; an
      // item spanning tracks larger than they are with their gaps shares the rest equally among
      // them, the fewest-spanning items first, as CSS grows intrinsic tracks.
      const tracks = (axis: Axis, template: readonly number[], gap: number) => {
        const items = asks(axis);
        const reach = Math.max(template.length, ...items.map(({ at, span }) => at + span));
        if (given?.axis === axis) {
          if (reach > given.sizes.length) problems.add('subgrid items past its tracks');
          return Array.from(
            { length: Math.max(reach, given.sizes.length) },
            (_, track) => given.sizes[track] ?? 0
          );
        }
        const sizes = Array.from(
          { length: reach },
          (_, track) =>
            template[track] ??
            Math.max(
              0,
              ...items.flatMap(({ at, span, size }) => (at === track && span === 1 ? [size] : []))
            )
        );
        for (const { at, span, size } of items
          .filter((item) => item.span > 1)
          .sort((a, b) => a.span - b.span)) {
          const covered = Array.from({ length: span }, (_, k) => at + k);
          const growing = covered.filter((track) => template[track] === undefined);
          const room =
            covered.reduce((total, track) => total + sizes[track], 0) + (covered.length - 1) * gap;
          const extra = size - room;
          if (extra > 0 && growing.length)
            for (const track of growing) sizes[track] += extra / growing.length;
        }
        return sizes;
      };
      // The room an item spanning tracks from `start` has: the tracks and the gaps between them.
      const spanned = (sizes: readonly number[], start: number, count: number, gap: number) =>
        sizes.slice(start, start + count).reduce((total, size) => total + size, 0) +
        (count - 1) * gap;
      const columns = tracks('column', look.gridTemplateColumns, columnGap);
      const rows = tracks('row', look.gridTemplateRows, rowGap);
      // Along a subgrid's axis its lines and its gap are its parent's.
      const lineGap = (axis: Axis, gap: number) => (given?.axis === axis ? given.lineGap : gap);
      const columnLines = lineGap('column', columnGap);
      const rowLines = lineGap('row', rowGap);
      const extent = (sizes: readonly number[], gap: number) =>
        sizes.reduce((total, size) => total + size, 0) + Math.max(0, sizes.length - 1) * gap;
      const starts = (sizes: readonly number[], gap: number, start: number, between: number) => {
        let at = start;
        return sizes.map((size) => {
          const here = at;
          at += size + gap + between;
          return here;
        });
      };
      // How far a subgrid child's box reaches out past its first and last tracks along its axis:
      // its padding and border, so its items stay on the tracks (see leavesOf).
      const outset = (index: number, axis: Axis) => {
        const item = kids[index];
        return 'element' in item && subgridAxis(item.look) === axis
          ? edgesAlong(item.look, axis)
          : [0, 0];
      };
      // A grid laying out its own tracks keeps room at its edges for the subgrids reaching past its
      // first and last tracks; one laid on its parent's tracks leaves that to its parent.
      const edgeRoom = (axis: Axis, count: number) => {
        if (given?.axis === axis) return [0, 0];
        let [start, end] = [0, 0];
        lines.forEach((line, index) => {
          if (!line) return;
          const [at, span] =
            axis === 'column' ? [line.column, line.columnSpan] : [line.row, line.rowSpan];
          const [before, after] = outset(index, axis);
          if (at === 0) start = Math.max(start, before);
          if (at + span === count) end = Math.max(end, after);
        });
        return [start, end];
      };
      const [roomLeft, roomRight] = edgeRoom('column', columns.length);
      const [roomTop, roomBottom] = edgeRoom('row', rows.length);
      const outerWidth =
        width ??
        (given?.axis === 'column'
          ? extent(columns, given.lineGap)
          : extent(columns, columnGap) + roomLeft + roomRight);
      const outerHeight =
        height ??
        (given?.axis === 'row'
          ? extent(rows, given.lineGap)
          : extent(rows, rowGap) + roomTop + roomBottom);
      const spread = distribute(
        outerWidth - extent(columns, columnGap) - roomLeft - roomRight,
        columns.length,
        look.justifyContent
      );
      const across =
        given?.axis === 'column'
          ? { start: 0, between: 0 }
          : { start: spread.start + roomLeft, between: spread.between };
      const xs = starts(columns, columnLines, across.start, across.between);
      const ys = starts(rows, rowLines, roomTop, 0);
      const children = lines.flatMap((line, index) => {
        if (!line) return [];
        const [left, right] = outset(index, 'column');
        const [top, bottom] = outset(index, 'row');
        const item = kids[index];
        const subgrid = 'element' in item ? subgridAxis(item.look) : undefined;
        if (subgrid && 'element' in item) {
          const [at, span] =
            subgrid === 'column' ? [line.column, line.columnSpan] : [line.row, line.rowSpan];
          giveTracks(item.element, {
            axis: subgrid,
            sizes: (subgrid === 'column' ? columns : rows).slice(at, at + span),
            lineGap: subgrid === 'column' ? columnLines + across.between : rowLines
          });
        }
        return place(
          index,
          xs[line.column] - left,
          ys[line.row] - top,
          spanned(columns, line.column, line.columnSpan, columnLines + across.between) +
            left +
            right,
          spanned(rows, line.row, line.rowSpan, rowLines) + top + bottom,
          subgrid
        );
      });
      return { width: outerWidth, height: outerHeight, children };
    }
    // A row or a column of tracks each as large as its item, as Node.svelte draws rows and columns,
    // places them as a flex line does: across, a row aligns them by align-items and a column by
    // justify-items, and its line stretches to the grid's size.
    const flowsAcross = look.gridAutoFlow.startsWith('column');
    if ((flowsAcross ? look.gridAutoColumns : look.gridAutoRows) === 'max-content') {
      if (flowsAcross) return flex({ ...look, flexDirection: 'row' }, items, width, height);
      const across = (alignment: string) => (alignment === 'legacy' ? 'normal' : alignment);
      return flex(
        { ...look, flexDirection: 'column', alignItems: across(look.justifyItems) },
        items.map((item) =>
          'element' in item
            ? { ...item, look: { ...item.look, alignSelf: item.look.justifySelf } }
            : item
        ),
        width,
        height
      );
    }
    if (look.gridAutoFlow.startsWith('column')) {
      if (look.gridAutoColumns !== '1fr')
        problems.add(`grid-auto-columns: ${look.gridAutoColumns}`);
      const track =
        width === undefined
          ? widest
          : Math.max(widest, laid((width - (count - 1) * columnGap) / Math.max(1, count)));
      const outer = width ?? count * track + Math.max(0, count - 1) * columnGap;
      const row = Math.max(tallest, height ?? 0);
      const children = kids.flatMap((_, index) =>
        place(index, index * (track + columnGap), 0, track, row)
      );
      return { width: count ? outer : (width ?? 0), height: tallest, children };
    }
    const outer = width ?? widest;
    if (look.gridAutoRows === '1fr') {
      const row =
        height === undefined
          ? tallest
          : Math.max(tallest, laid((height - (count - 1) * rowGap) / Math.max(1, count)));
      const children = kids.flatMap((_, index) =>
        place(index, 0, index * (row + rowGap), outer, row)
      );
      return { width: outer, height: count * tallest + Math.max(0, count - 1) * rowGap, children };
    }
    if (look.gridAutoRows !== 'auto') problems.add(`grid-auto-rows: ${look.gridAutoRows}`);
    // Each item a row of its own, as tall as it is, the room left shared between the rows.
    const rows = kids.map((item, index) =>
      stretches(justifyOf(item)) ? sizeOf(item, outer).height : natural[index].height
    );
    const sum = rows.reduce((total, size) => total + size, 0) + Math.max(0, count - 1) * rowGap;
    const extra = height !== undefined && height > sum && count ? divided(height - sum, count) : 0;
    let y = 0;
    const children = kids.flatMap((_, index) => {
      const placed = place(index, 0, y, outer, rows[index] + extra);
      y += rows[index] + extra + rowGap;
      return placed;
    });
    return { width: outer, height: sum, children };
  }

  type Piece = {
    element: ModelElement;
    x: number;
    /** Its top, from the baseline. */
    top: number;
    width: number;
    height: number;
    atomic?: Fragment;
    inner: Piece[];
  };
  type Line = {
    x: number;
    top: number;
    bottom: number;
    xHeight: number;
    /** At a space: a space starting the next text collapses. */
    space: boolean;
    pending?: { look: Look; text: string; width: number };
  };

  const metricsOf = (look: Look) => {
    const { ascent, descent, xHeight } = measure.metrics(fontOf(look));
    return { ascent: Math.round(ascent), descent: Math.round(descent), xHeight };
  };
  /**
   * A box's strut: the room its own font and line height take about the baseline, the leading
   * above it in whole pixels, as the browser puts it, and the rest below.
   */
  const strut = (look: Look) => {
    const { ascent, descent } = metricsOf(look);
    const height = look.lineHeight === 'normal' ? ascent + descent : laid(look.lineHeight);
    const top = -(ascent + Math.floor(halved(height - (ascent + descent))));
    return { top, bottom: height + top };
  };
  // A text's advance in its case: its runs' widths summed, as the browser shapes each alone, and
  // rounded once (see text-case.ts).
  const textWidth = (text: string, look: Look) =>
    advance(
      casedRuns(text, caseOf(look.textTransform, look.fontVariantCaps)).reduce(
        (sum, run) =>
          sum +
          measure.width(
            run.text,
            fontOf(run.small ? { ...look, fontSize: smallCapsSize(look.fontSize) } : look)
          ),
        0
      )
    );

  /** One line of inline content: its width, its height, and where the boxes in it sit. */
  function inline(look: Look, items: readonly Item[], width?: number): Content {
    const { top, bottom } = strut(look);
    const line: Line = { x: 0, top, bottom, xHeight: metricsOf(look).xHeight, space: true };
    const pieces: Piece[] = [];
    walk(items, look, line, pieces);
    // A space ending the line hangs, taking no room.
    if (width !== undefined && line.x > width + 1 / units) problems.add('text wrapping');
    const placedOf = (piece: Piece, originX: number, originTop: number): Placed => ({
      fragment: piece.atomic ?? {
        element: piece.element,
        width: piece.width,
        height: piece.height,
        children: piece.inner.map((inner) => placedOf(inner, piece.x, piece.top))
      },
      x: piece.x - originX,
      y: piece.top - originTop
    });
    return {
      width: width ?? line.x,
      height: line.bottom - line.top,
      children: pieces.map((piece) => placedOf(piece, 0, line.top))
    };
  }

  /** A space a text ended with is part of that text, measured with it, once the line goes on. */
  function confirmSpace(line: Line) {
    const pending = line.pending;
    if (!pending) return;
    line.x += textWidth(`${pending.text} `, pending.look) - pending.width;
    line.pending = undefined;
  }

  // Anonymous boxes, which are taken out of the boxes once placed.
  const anonymousBoxes = new Set<ModelElement>();
  function anonymousBox({ width, height, children }: Content): Fragment {
    const element: ModelElement = { tag: '#anonymous', attributes: {}, style: {}, children: [] };
    anonymousBoxes.add(element);
    return { element, width, height, children };
  }

  // Each text drawn is placed as a piece of its own standing for it, one for each text of an
  // element, and taken out of the boxes once placed.
  const textPieces = new Map<ModelElement, ModelElement[]>();
  const drawnTexts = new Map<
    ModelElement,
    { owner: ModelElement; index: number; text: string; look: Look }
  >();
  function textPiece(item: TextItem, text: string, start: number, end: number): Piece {
    const own = textPieces.get(item.owner) ?? [];
    textPieces.set(item.owner, own);
    const element = (own[item.index] ??= { tag: '#text', attributes: {}, style: {}, children: [] });
    drawnTexts.set(element, { owner: item.owner, index: item.index, text, look: item.look });
    const { ascent, descent } = metricsOf(item.look);
    return {
      element,
      x: start,
      top: -ascent,
      width: end - start,
      height: ascent + descent,
      inner: []
    };
  }

  function walk(items: readonly Item[], look: Look, line: Line, pieces: Piece[]) {
    const preserved = ['pre', 'pre-wrap', 'break-spaces'].includes(look.whiteSpace);
    for (const item of items) {
      if ('text' in item) {
        // Each text is measured on its own, its width rounded up on its own.
        if (preserved) {
          let first: number | undefined;
          let last = line.x;
          item.text.split('\t').forEach((part, index) => {
            if (index) {
              const tab = item.look.tabSize * textWidth(' ', item.look);
              line.x = (Math.floor(line.x / tab + 1e-6) + 1) * tab;
            }
            if (part.trim()) {
              const leading = /^\s*/u.exec(part)?.[0] ?? '';
              first ??= line.x + (leading ? textWidth(leading, item.look) : 0);
              last = line.x + textWidth(part.trimEnd(), item.look);
            }
            if (part) line.x += textWidth(part, item.look);
          });
          if (first !== undefined)
            pieces.push(textPiece(item, item.text.replace(/\s+/gu, ' ').trim(), first, last));
          line.space = false;
          continue;
        }
        let text = item.text.replace(/[ \t\n\r]+/gu, ' ');
        if (line.space) text = text.replace(/^ /u, '');
        if (!text) continue;
        const trailing = text.endsWith(' ');
        if (trailing) text = text.slice(0, -1);
        confirmSpace(line);
        const measured = text ? textWidth(text, item.look) : 0;
        const shown = text.trimStart();
        if (shown) {
          const end = line.x + measured;
          pieces.push(textPiece(item, shown, end - textWidth(shown, item.look), end));
        }
        line.x += measured;
        line.pending = trailing ? { look: item.look, text, width: measured } : undefined;
        line.space = trailing;
        continue;
      }
      const own = item.look;
      const [, right, , left] = margins(own);
      if (own.display === 'inline') {
        const { ascent, descent } = metricsOf(own);
        const { top, bottom } = strut(own);
        line.top = Math.min(line.top, top);
        line.bottom = Math.max(line.bottom, bottom);
        if (own.verticalAlign !== 'baseline')
          problems.add(`vertical-align: ${own.verticalAlign} on text`);
        const lead = laid(own.padding[3]) + own.border[3];
        const tail = laid(own.padding[1]) + own.border[1];
        confirmSpace(line);
        line.x += left;
        const start = line.x;
        line.x += lead;
        const inner: Piece[] = [];
        walk(itemsOf(item.element), own, line, inner);
        line.x += tail;
        const boxTop = -ascent - laid(own.padding[0]) - own.border[0];
        pieces.push({
          element: item.element,
          x: start,
          top: boxTop,
          width: line.x - start,
          height:
            ascent +
            descent +
            laid(own.padding[0]) +
            laid(own.padding[2]) +
            own.border[0] +
            own.border[2],
          inner
        });
        line.x += right;
        continue;
      }
      if (!inlineLevel(own.display)) problems.add(`${own.display} in a line`);
      const fragment = box(item.element);
      confirmSpace(line);
      line.x += left;
      let boxTop: number;
      const raised = lengthAlign(own);
      if (own.verticalAlign === 'middle') {
        boxTop = -line.xHeight / 2 - fragment.height / 2;
      } else if (raised !== undefined) {
        // A length raises the box's bottom, its baseline, above the line's: inline maths sits so.
        boxTop = -raised - fragment.height;
      } else {
        problems.add(`vertical-align: ${own.verticalAlign} on ${own.display}`);
        boxTop = -fragment.height;
      }
      line.top = Math.min(line.top, boxTop);
      line.bottom = Math.max(line.bottom, boxTop + fragment.height);
      pieces.push({
        element: item.element,
        x: line.x,
        top: boxTop,
        width: fragment.width,
        height: fragment.height,
        atomic: fragment,
        inner: []
      });
      line.x += fragment.width + right;
      line.space = false;
    }
  }

  /**
   * An element out of flow, placed in the padding box of the element its position is taken from:
   * its insets, else where it would sit in flow, at the top left of its parent's content.
   */
  function placeOutOfFlow(element: ModelElement, holder: Box, holderLook: Look): Placed {
    const look = lookAt(element);
    const area = {
      x: holder.x + holderLook.border[3],
      y: holder.y + holderLook.border[0],
      width: holder.width - holderLook.border[1] - holderLook.border[3],
      height: holder.height - holderLook.border[0] - holderLook.border[2]
    };
    const resolve = (length: Length | 'auto', base: number) =>
      length === 'auto' ? undefined : laid(length.px + (length.percent / 100) * base);
    const [top, right, bottom, left] = look.inset.map((inset, index) =>
      resolve(inset, index % 2 ? area.width : area.height)
    );
    const [marginTop, marginRight, marginBottom, marginLeft] = margins(look);
    const { horizontal, vertical } = edges(look);
    let fragment: Fragment;
    if (element.tag === 'svg') {
      const size = (length: Length | 'auto' | 'max-content', attribute: string, base: number) =>
        typeof length === 'object'
          ? laid(length.px + (length.percent / 100) * base)
          : laid(parseFloat(element.attributes[attribute] ?? '0') || 0);
      fragment = {
        element,
        width:
          look.width === 'auto' &&
          left !== undefined &&
          right !== undefined &&
          !element.attributes.width
            ? area.width - left - right
            : size(look.width, 'width', area.width),
        height:
          look.height === 'auto' &&
          top !== undefined &&
          bottom !== undefined &&
          !element.attributes.height
            ? area.height - top - bottom
            : size(look.height, 'height', area.height),
        children: []
      };
    } else {
      const stretchedWidth =
        look.width === 'auto' && left !== undefined && right !== undefined
          ? area.width - left - right - marginLeft - marginRight
          : undefined;
      const stretchedHeight =
        look.height === 'auto' && top !== undefined && bottom !== undefined
          ? area.height - top - bottom - marginTop - marginBottom
          : undefined;
      if (typeof look.width === 'object' && look.width.percent)
        problems.add('percentage widths out of flow');
      if (look.width === 'auto' && stretchedWidth === undefined) {
        // Shrink to fit: as wide as its content, which the model takes never to wrap.
        const room = area.width - (left ?? 0) - (right ?? 0) - marginLeft - marginRight;
        const own = box(element);
        if (own.width > room + 1 / units && hasBreaks(element))
          problems.add('text out of flow narrowed');
      }
      void horizontal;
      void vertical;
      fragment = box(element, stretchedWidth, stretchedHeight);
    }
    const x =
      left !== undefined
        ? area.x + left + marginLeft
        : right !== undefined
          ? area.x + area.width - right - marginRight - fragment.width
          : staticPosition(element, 'x');
    const y =
      top !== undefined
        ? area.y + top + marginTop
        : bottom !== undefined
          ? area.y + area.height - bottom - marginBottom - fragment.height
          : staticPosition(element, 'y');
    return { fragment, x, y };
  }

  // Each element's parent, for an element out of flow with no insets, placed where it would be.
  const parents = new Map<ModelElement, ModelElement>();
  const link = (element: ModelElement) => {
    for (const child of element.children)
      if (isElement(child)) {
        parents.set(child, element);
        link(child);
      }
  };
  link(root);
  const boxes = new Map<ModelElement, Box>();
  function staticPosition(element: ModelElement, axis: 'x' | 'y'): number {
    const parent = parents.get(element);
    const at = parent ? boxes.get(parent) : undefined;
    if (!parent || !at) {
      problems.add('out of flow with no insets, outside its parent');
      return 0;
    }
    const look = lookAt(parent);
    const { left, top } = edges(look);
    if (/(flex|grid)$/u.test(look.display) && look.justifyContent !== 'normal')
      problems.add('out of flow with no insets, in an aligned box');
    return axis === 'x' ? at.x + left : at.y + top;
  }
  const hasBreaks = (element: ModelElement): boolean =>
    lookAt(element).whiteSpace !== 'nowrap' &&
    lookAt(element).whiteSpace !== 'pre' &&
    element.children.some((child) =>
      isElement(child) ? hasBreaks(child) : /\S\s+\S/u.test(child)
    );

  function record(fragment: Fragment, x: number, y: number) {
    const own = { x, y, width: fragment.width, height: fragment.height };
    boxes.set(fragment.element, own);
    for (const child of fragment.children) record(child.fragment, x + child.x, y + child.y);
    for (const element of outOfFlow.get(fragment.element) ?? []) {
      const placed = placeOutOfFlow(element, own, lookAt(fragment.element));
      record(placed.fragment, placed.x, placed.y);
    }
  }
  record(box(root), 0, 0);
  for (const element of anonymousBoxes) boxes.delete(element);
  const texts = new Map<ModelElement, ModelText[]>();
  for (const [element, { owner, index, text, look }] of drawnTexts) {
    const placed = boxes.get(element);
    boxes.delete(element);
    if (placed) texts.set(owner, [...(texts.get(owner) ?? []), { text, index, box: placed, look }]);
  }
  return { boxes, looks, problems: [...problems], texts };
}
