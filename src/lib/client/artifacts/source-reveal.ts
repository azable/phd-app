/**
 * CodeMirror marks for regions shown from elsewhere, as code a message names or the problems of a
 * failed build: a tint that flashes in, over each region, until another is shown or the text is
 * edited.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import type { SourceRange } from './source-references';

/** Replace the revealed regions; none clears them. */
export const setRevealed = StateEffect.define<readonly SourceRange[]>();

const revealedMark = Decoration.mark({ class: 'cm-revealed' });

function decorations(state: EditorState, ranges: readonly SourceRange[]): DecorationSet {
  const length = state.doc.length;
  return Decoration.set(
    ranges
      .map(({ from, to }) => ({ from: Math.min(from, length), to: Math.min(to, length) }))
      .filter(({ from, to }) => to > from)
      .map(({ from, to }) => revealedMark.range(from, to)),
    true
  );
}

const revealedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    // Editing the text ends what was shown.
    let next = transaction.docChanged ? Decoration.none : value;
    for (const effect of transaction.effects)
      if (effect.is(setRevealed)) next = decorations(transaction.state, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const revealedTheme = EditorView.baseTheme({
  '@keyframes cm-revealed-flash': {
    from: { backgroundColor: 'color-mix(in oklab, #d97706 55%, transparent)' },
    to: { backgroundColor: 'color-mix(in oklab, #d97706 22%, transparent)' }
  },
  '.cm-revealed': {
    backgroundColor: 'color-mix(in oklab, #d97706 22%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in oklab, #d97706 55%, transparent)',
    borderRadius: '2px',
    animation: 'cm-revealed-flash 900ms ease-out'
  }
});

/** The extensions that let an editor show revealed regions. */
export const revealedRegions = [revealedField, revealedTheme];

/** A transaction spec that shows these regions and scrolls the first into view. */
export function showRevealed(state: EditorState, ranges: readonly SourceRange[]): TransactionSpec {
  const first = ranges.find(({ from }) => from <= state.doc.length);
  return {
    effects: [
      setRevealed.of(ranges),
      ...(first ? [EditorView.scrollIntoView(first.from, { y: 'center' })] : [])
    ]
  };
}
