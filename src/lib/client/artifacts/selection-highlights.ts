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

/** The position of a selected element's tag, with line and column both from 1. */
export type SourceHighlight = { line: number; column: number };

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
  for (const { line, column } of highlights) {
    if (line < 1 || line > state.doc.lines) continue;
    const from = state.doc.line(line).from + column - 1;
    // A selection names a node or a link component.
    const tag = state.doc.sliceString(from, from + 5);
    if (tag !== '<Node' && tag !== '<Link') continue;
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
