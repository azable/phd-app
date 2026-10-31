/**
 * The layout model: every element's box worked out from a step's markup (see tree.ts), the
 * library's style sheets (see css.ts, look.ts) and text widths, with nothing read from a laid-out
 * page. It lays out what views draw, as the browser does, to its 64ths of a pixel: blocks stacked,
 * flex rows and columns on one line, grids of one column or of equal tracks, lines of text with
 * views inside them, and boxes placed out of flow. What it does not model it refuses, naming it in
 * `problems`, rather than guessing.
 */

import type { Rule } from './css';
import { lookOf, type Length, type Look, type Styled, type Styler } from './look';
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
};

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
type Content = { width: number; height: number; children: Placed[] };
type Item = { text: string; look: Look } | { element: ModelElement; look: Look };

const units = 64;
/** A computed length as layout takes it: a 32-bit float in 64ths of a pixel, toward zero. */
const laid = (value: number) => Math.trunc(Math.fround(value) * units) / units;
/** A text advance as layout takes it: rounded up to the next 64th. */
const advance = (value: number) => Math.ceil(value * units - 1e-6) / units;
/** Layout halves in whole 64ths, toward zero. */
const halved = (value: number) => Math.trunc((value * units) / 2) / units;
const divided = (value: number, by: number) => Math.trunc((value * units) / by) / units;

const fontOf = (look: Look) =>
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
  const itemsOf = (element: ModelElement): Item[] =>
    element.children.flatMap((child): Item[] => {
      if (!isElement(child)) return child.length ? [{ text: child, look: lookAt(element) }] : [];
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
    const toBorder = (size: number, edge: number) => (look.borderBox ? size : size + edge);
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
    if (display === 'grid' || display === 'inline-grid') return grid(look, items, width, height);
    if (['block', 'inline-block', 'flow-root', 'list-item'].includes(display))
      return block(look, items, width);
    if (display === 'inline') return inline(look, items, width);
    problems.add(`display: ${display}`);
    return { width: 0, height: 0, children: [] };
  }

  const hasInline = (items: readonly Item[]) =>
    items.some((item) => ('text' in item ? item.text.trim() : inlineLevel(item.look.display)));

  const margins = (look: Look) => look.margin.map((side) => (side === 'auto' ? 0 : laid(side)));

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
    if (items.some((item) => 'text' in item && item.text.trim()))
      problems.add('text in a flex box');
    const kids = items.flatMap((item) => ('element' in item ? [item] : []));
    const row = look.flexDirection.startsWith('row');
    if (look.flexDirection.endsWith('reverse')) problems.add('reversed flex boxes');
    const gap = laid(row ? look.columnGap : look.rowGap);
    const gaps = Math.max(0, kids.length - 1) * gap;
    const alignmentOf = (own: Look) => (own.alignSelf === 'auto' ? look.alignItems : own.alignSelf);
    const natural = kids.map(({ element }) => box(element));
    if (row) {
      const sum = natural.reduce((total, fragment) => total + fragment.width, 0) + gaps;
      const outer = width ?? sum;
      if (sum > outer + 1 / units) problems.add('flex items shrinking');
      const line = height ?? Math.max(0, ...natural.map((fragment) => fragment.height));
      const { start, between } = distribute(outer - sum, kids.length, look.justifyContent);
      let x = start;
      const children = kids.map(({ element, look: own }, index): Placed => {
        const alignment = alignmentOf(own);
        const fragment =
          stretches(alignment) && own.height === 'auto'
            ? box(element, natural[index].width, line)
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
    const laidOut = kids.map(({ element, look: own }, index) =>
      stretches(alignmentOf(own)) && own.width === 'auto' ? box(element, outer) : natural[index]
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

  function grid(look: Look, items: readonly Item[], width?: number, height?: number): Content {
    const kids = items.filter((item) => 'element' in item || item.text.trim());
    const anonymous = (item: Item, at?: number): Fragment | undefined =>
      'element' in item ? box(item.element, at) : undefined;
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
    /** Place an item in its cell, stretching it where its alignment says. */
    const place = (index: number, x: number, y: number, cellWidth: number, cellHeight: number) => {
      const item = kids[index];
      const justify = justifyOf(item);
      const align = alignOf(item);
      const stretchedWidth =
        stretches(justify) && !('element' in item && item.look.width !== 'auto');
      const stretchedHeight =
        stretches(align) && !('element' in item && item.look.height !== 'auto');
      const fragment =
        'element' in item
          ? box(
              item.element,
              stretchedWidth ? cellWidth : natural[index].width,
              stretchedHeight ? cellHeight : undefined
            )
          : undefined;
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
    void anonymous;
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
  const textWidth = (text: string, look: Look) => advance(measure.width(text, fontOf(look)));

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

  function walk(items: readonly Item[], look: Look, line: Line, pieces: Piece[]) {
    const preserved = ['pre', 'pre-wrap', 'break-spaces'].includes(look.whiteSpace);
    for (const item of items) {
      if ('text' in item) {
        // Each text is measured on its own, its width rounded up on its own.
        if (preserved) {
          item.text.split('\t').forEach((part, index) => {
            if (index) {
              const tab = item.look.tabSize * textWidth(' ', item.look);
              line.x = (Math.floor(line.x / tab + 1e-6) + 1) * tab;
            }
            if (part) line.x += textWidth(part, item.look);
          });
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
      if (own.verticalAlign === 'middle') {
        boxTop = -line.xHeight / 2 - fragment.height / 2;
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
  return { boxes, looks, problems: [...problems] };
}
