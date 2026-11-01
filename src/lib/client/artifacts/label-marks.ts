/**
 * The algorithm's label marks, `@name[`, `@name{`, and the `]` closing a span, dimmed in the
 * editor so the code around them reads as before (see the Sverlin guide's Steps), and each label's
 * full name, as a label inside another takes that one's as a prefix, for its pauses.
 */

import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';

const sverlinBlock = /<script\b([^>]*\blang="sverlin"[^>]*)>([\s\S]*?)<\/script>/gu;
const marker = /^@[A-Za-z_$][\w$]*(?:[ \t]*\{|\[)/u;

/** A label where the algorithm opens it: its mark, from `@` to its name's end, and its full name. */
export type LabelOpening = { from: number; to: number; full: string };

/**
 * Where the label marks are in a source, as [from, to) ranges in order, and where each label of the
 * algorithm opens. In code, strings and comments are skipped; in a listing, any text is.
 */
function scan(source: string): { marks: [number, number][]; openings: LabelOpening[] } {
  const marks: [number, number][] = [];
  const openings: LabelOpening[] = [];
  for (const block of source.matchAll(sverlinBlock)) {
    const listing = /\blisting=/u.test(block[1]);
    const start = (block.index ?? 0) + block[0].length - block[2].length - '</script>'.length;
    const text = block[2];
    const open: (number | null)[] = [];
    // The algorithm's open brackets, each with the label it opens, for full names.
    const around: { bracket: string; label?: string }[] = [];
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
        if (!listing) {
          const name = written.slice(1, bracket === '{' ? end : -1);
          const full = [...around.flatMap(({ label }) => label ?? []), name].join('.');
          openings.push({ from: start + at, to: start + at + 1 + name.length, full });
          around.push({ bracket: bracket === '{' ? '{' : '[', label: name });
        }
        at += written.length - 1;
        continue;
      }
      if (character === '[' || character === '{') around.push({ bracket: character });
      if (
        (character === ']' || character === '}') &&
        around.at(-1)?.bracket === (character === ']' ? '[' : '{')
      )
        around.pop();
      if (character === '[') open.push(null);
      if (character === ']' && open.length && open.pop() !== null)
        marks.push([start + at, start + at + 1]);
    }
  }
  return { marks: marks.sort(([a], [b]) => a - b), openings };
}

export const labelMarks = (source: string): [number, number][] => scan(source).marks;

/** Each label of the algorithm where it opens, in order, with its full name. */
export const labelOpenings = (source: string): LabelOpening[] => scan(source).openings;

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
    // Over the JavaScript highlighting, which reads a mark as invalid.
    EditorView.theme({
      '.cm-sverlin-label, .cm-sverlin-label *': {
        color: 'var(--muted-foreground) !important',
        opacity: '0.7',
        textDecoration: 'none !important',
        fontWeight: 'normal !important'
      }
    })
  ];
}
