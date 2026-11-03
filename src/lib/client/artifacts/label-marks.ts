/**
 * The algorithm's label marks, `@name[`, `@name{`, and the `]` closing a span, dimmed in the
 * editor so the code around them reads as before (see the Sverlin guide's Steps), and each label's
 * full name, as a label inside another takes that one's as a prefix, for its pauses. Hovering a
 * label, where it opens or where the view or a variant names it, highlights every place with its
 * full name and tints the code each of its openings marks.
 */

import { RangeSetBuilder, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';

import { referenceRanges } from './source-references';

const sverlinBlock = /<script\s+(domain|input|algorithm|listing="[^"]*")\s*>([\s\S]*?)<\/script>/gu;
const marker = /^@[A-Za-z_$][\w$]*(?:[ \t]*\{|\[)/u;

/** A label where the algorithm opens it: its mark, from `@` to its name's end, and its full name. */
export type LabelOpening = { from: number; to: number; full: string };

/**
 * A label where the algorithm or a listing opens it, with the code it marks: from its `@` to the
 * `]` closing its span, or the `}` closing its block; to the text's end where nothing closes it.
 */
export type LabelRegion = LabelOpening & { end: number };

/**
 * Where the label marks are in a source, as [from, to) ranges in order, where each label of the
 * algorithm opens, and each label's region, the algorithm's and the listings'. In code, strings and
 * comments are skipped; in a listing, any text is.
 */
function scan(source: string): {
  marks: [number, number][];
  openings: LabelOpening[];
  regions: LabelRegion[];
} {
  const marks: [number, number][] = [];
  const openings: LabelOpening[] = [];
  const regions: LabelRegion[] = [];
  for (const block of source.matchAll(sverlinBlock)) {
    const listing = /\blisting=/u.test(block[1]);
    const start = (block.index ?? 0) + block[0].length - block[2].length - '</script>'.length;
    const text = block[2];
    const open: (number | null)[] = [];
    // The open brackets, each with the label it opens, for full names and where regions end.
    const around: { bracket: string; label?: string; region?: LabelRegion }[] = [];
    for (let at = 0; at < text.length; at++) {
      const character = text[at];
      if (!listing && character === '/' && (text[at + 1] === '/' || text[at + 1] === '*')) {
        const end = text[at + 1] === '/' ? text.indexOf('\n', at) : text.indexOf('*/', at) + 1;
        at = end <= 0 ? text.length : end;
        continue;
      }
      if (!listing && (character === '"' || character === "'" || character === '`')) {
        let end = at + 1;
        while (end < text.length && text[end] !== character) end += text[end] === '\\' ? 2 : 1;
        at = end;
        continue;
      }
      const written = character === '@' ? marker.exec(text.slice(at))?.[0] : undefined;
      if (written) {
        const bracket = written.at(-1);
        // A block's { is code, so only the name before it is a mark.
        const end = bracket === '{' ? written.slice(0, -1).trimEnd().length : written.length;
        marks.push([start + at, start + at + end]);
        if (bracket === '[') open.push(start + at);
        // A listing's labels are spans only; its braces are its own code.
        if (!listing || bracket === '[') {
          const name = written.slice(1, bracket === '{' ? end : -1);
          const full = [...around.flatMap(({ label }) => label ?? []), name].join('.');
          const opening = { from: start + at, to: start + at + 1 + name.length, full };
          const region = { ...opening, end: start + text.length };
          if (!listing) openings.push(opening);
          regions.push(region);
          around.push({ bracket: bracket === '{' ? '{' : '[', label: name, region });
        } else around.push({ bracket: '{' });
        at += written.length - 1;
        continue;
      }
      if (character === '[' || character === '{') around.push({ bracket: character });
      if (
        (character === ']' || character === '}') &&
        around.at(-1)?.bracket === (character === ']' ? '[' : '{')
      ) {
        const closed = around.pop();
        if (closed?.region) closed.region.end = start + at + 1;
      }
      if (character === '[') open.push(null);
      if (character === ']' && open.length && open.pop() !== null)
        marks.push([start + at, start + at + 1]);
    }
  }
  return { marks: marks.sort(([a], [b]) => a - b), openings, regions };
}

export const labelMarks = (source: string): [number, number][] => scan(source).marks;

/** Each label of the algorithm where it opens, in order, with its full name. */
export const labelOpenings = (source: string): LabelOpening[] => scan(source).openings;

/** Each label of the algorithm and the listings, in order, with its full name and its region. */
export const labelRegions = (source: string): LabelRegion[] => scan(source).regions;

const labelReference = /@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/gu;

/**
 * The full name of the label at a position: an opening's, or a name written after `@` elsewhere
 * (`<When of="@insert.key">`, `pause@insert.key`) that some opening has; none at any other text.
 */
export function labelAt(
  source: string,
  regions: readonly LabelRegion[],
  at: number
): string | undefined {
  const opened = regions.find(({ from, to }) => from <= at && at <= to);
  if (opened) return opened.full;
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = source.indexOf('\n', at);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  for (const match of line.matchAll(labelReference)) {
    const from = lineStart + (match.index ?? 0);
    if (at < from || at > from + match[0].length) continue;
    const full = match[0].slice(1);
    return regions.some((region) => region.full === full) ? full : undefined;
  }
  return undefined;
}

/**
 * What hovering a label highlights: every place its full name is written (where it opens, and where
 * the view or a variant reads it, as a message's reference to it shows them) and the region each of
 * its openings marks.
 */
export function labelHighlights(
  source: string,
  regions: readonly LabelRegion[],
  full: string
): { names: { from: number; to: number }[]; regions: { from: number; to: number }[] } {
  const own = regions.filter((region) => region.full === full);
  const names = new Map<number, { from: number; to: number }>();
  for (const range of [...referenceRanges(source, `@${full}`), ...own])
    names.set(range.from, range);
  return {
    names: [...names.values()]
      .map(({ from, to }) => ({ from, to }))
      .sort((a, b) => a.from - b.from),
    regions: own.map(({ from, end }) => ({ from, to: end }))
  };
}

const hoveredName = Decoration.mark({ class: 'cm-label-hovered' });
const hoveredRegion = Decoration.mark({ class: 'cm-label-hovered-region' });

/** Highlight the label under the pointer, everywhere it is written, and the code it marks. */
const labelHover = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    regions: LabelRegion[];
    hovered: string | undefined;
    constructor(readonly view: EditorView) {
      this.regions = labelRegions(view.state.doc.toString());
    }
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      this.regions = labelRegions(update.state.doc.toString());
      this.hovered = undefined;
      this.decorations = Decoration.none;
    }
    hover(full: string | undefined) {
      if (full === this.hovered) return;
      this.hovered = full;
      const source = this.view.state.doc.toString();
      const found = full ? labelHighlights(source, this.regions, full) : undefined;
      const marks: Range<Decoration>[] = [
        ...(found?.regions ?? []).map(({ from, to }) => hoveredRegion.range(from, to)),
        ...(found?.names ?? []).map(({ from, to }) => hoveredName.range(from, to))
      ];
      this.decorations = Decoration.set(marks, true);
      // Decorations change outside a transaction, so ask for a redraw.
      this.view.dispatch({});
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousemove(event, view) {
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        const source = view.state.doc.toString();
        this.hover(at === null ? undefined : labelAt(source, this.regions, at));
      },
      mouseleave() {
        this.hover(undefined);
      }
    }
  }
);

const dimmed = Decoration.mark({ class: 'cm-sverlin-label' });

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const [from, to] of labelMarks(view.state.doc.toString())) builder.add(from, to, dimmed);
  return builder.finish();
}

/** Dim the label marks of the source being edited. */
export function sverlinLabelMarks(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.decorations = decorate(update.view);
        }
      },
      { decorations: (plugin) => plugin.decorations }
    ),
    labelHover,
    // Over the JavaScript highlighting, which reads a mark as invalid.
    EditorView.theme({
      '.cm-sverlin-label, .cm-sverlin-label *': {
        color: 'var(--muted-foreground) !important',
        opacity: '0.7',
        textDecoration: 'none !important',
        fontWeight: 'normal !important'
      },
      // A hovered label's names stand out of their dimming; the code it marks takes a light tint.
      '.cm-label-hovered, .cm-label-hovered *': {
        color: 'var(--card-foreground) !important',
        opacity: '1'
      },
      '.cm-label-hovered': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 22%, transparent)',
        borderRadius: '2px'
      },
      '.cm-label-hovered-region': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 9%, transparent)'
      }
    })
  ];
}
