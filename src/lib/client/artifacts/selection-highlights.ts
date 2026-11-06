/**
 * CodeMirror highlights for the <Node> and <Link> tags behind elements a participant selected in a
 * presentation: a tint on the lines each tag spans and a mark over the tag itself.
 *
 * @packageDocumentation
 */

import {
  StateEffect,
  StateField,
  type EditorState,
  type Range,
  type TransactionSpec
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import { locateElement } from '$lib/modes/sverlin/element-ref';
import { labelCode } from '$lib/modes/sverlin/listing/source-lines';

import { placeRanges } from './source-references';

/**
 * The position of a selected element's tag, with line and column both from 1; or a range of the
 * source by offset, as a selected listing line's line in its block or its label's code.
 */
export type SourceHighlight = { line: number; column: number } | { from: number; to: number };

/**
 * What a selected element highlights in its source: its tag; for a listing's line, also that line
 * in its block and the algorithm code of the innermost label round it, or, where a token on it was
 * clicked, every place the token's place is declared and drawn.
 */
export function elementHighlights(
  source: string,
  element: { id: string; place?: string },
  listingName?: string
): SourceHighlight[] {
  const located = locateElement(source, element.id, listingName);
  if (!located) return [];
  const tag: SourceHighlight = { line: located.line, column: located.column };
  const listing = located.listing;
  if (!listing && !element.place) return [tag];
  const starts = [0];
  for (const line of source.split('\n')) starts.push(starts.at(-1)! + line.length + 1);
  const lines: SourceHighlight[] = listing
    ? [{ from: starts[listing.lines.first - 1], to: starts[listing.lines.last] - 1 }]
    : [];
  if (element.place) return [tag, ...lines, ...placeRanges(source, element.place)];
  const code = listing?.labels.length ? labelCode(source, listing.labels.at(-1)!) : undefined;
  return [tag, ...lines, ...(code ? [{ from: code.from, to: code.end }] : [])];
}

/** Replace the highlighted tags; the editor scrolls to the first. */
export const setSourceHighlights = StateEffect.define<readonly SourceHighlight[]>();

const selectedLine = Decoration.line({ class: 'cm-selected-node-line' });
const selectedTag = Decoration.mark({ class: 'cm-selected-node' });

/** The span of each highlighted <Node> tag in a document, skipping positions that hold none. */
export function highlightRanges(
  state: EditorState,
  highlights: readonly SourceHighlight[]
): { from: number; to: number }[] {
  const ranges = new Map<number, { from: number; to: number }>();
  for (const highlight of highlights) {
    if ('from' in highlight) {
      const from = Math.max(0, Math.min(highlight.from, state.doc.length));
      const to = Math.max(from, Math.min(highlight.to, state.doc.length));
      if (to > from) ranges.set(from, { from, to });
      continue;
    }
    const { line, column } = highlight;
    if (line < 1 || line > state.doc.lines) continue;
    const from = state.doc.line(line).from + column - 1;
    // A selection names a node, link, or listing component.
    const tag = state.doc.sliceString(from, from + 8);
    if (!/^<(?:Node|Link|Listing)\b/u.test(tag)) continue;
    ranges.set(from, { from, to: tagEnd(state.doc.sliceString(from, from + 4000)) + from });
  }
  return [...ranges.values()].sort((a, b) => a.from - b.from);
}

/** The offset just past a tag's closing >, skipping > inside {expressions} and quoted values. */
export function tagEnd(text: string): number {
  let depth = 0;
  let quote = '';
  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '{') depth++;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (character === '"' || character === "'")) quote = character;
    else if (depth === 0 && character === '>') return index + 1;
  }
  return '<Node'.length; // '<Link' is as long
}

function decorations(state: EditorState, highlights: readonly SourceHighlight[]): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of highlightRanges(state, highlights)) {
    for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line++)
      marks.push(selectedLine.range(state.doc.line(line).from));
    marks.push(selectedTag.range(from, to));
  }
  return Decoration.set(marks, true);
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setSourceHighlights)) next = decorations(transaction.state, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const highlightTheme = EditorView.baseTheme({
  '.cm-selected-node-line': {
    backgroundColor: 'color-mix(in oklab, #2563eb 10%, transparent)'
  },
  '.cm-selected-node': {
    backgroundColor: 'color-mix(in oklab, #2563eb 22%, transparent)',
    outline: '1px solid color-mix(in oklab, #2563eb 60%, transparent)',
    borderRadius: '2px'
  }
});

/** The extensions that let an editor show source highlights. */
export const sourceHighlights = [highlightField, highlightTheme];

/** A transaction spec that shows these highlights and scrolls the first into view. */
export function showSourceHighlights(
  state: EditorState,
  highlights: readonly SourceHighlight[]
): TransactionSpec {
  const first = highlightRanges(state, highlights)[0];
  return {
    effects: [
      setSourceHighlights.of(highlights),
      ...(first ? [EditorView.scrollIntoView(first.from, { y: 'center' })] : [])
    ]
  };
}
