/**
 * CodeMirror markers for the values a presentation's seed drew in the design block: a mark over
 * each draw call and, after it, the value each shown presentation drew there.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import type { DesignDraw } from '$lib/shared/presentations';

/** The draws of one shown presentation, with the label that tells it apart in a comparison. */
export type DrawnPresentation = { label?: string; seed: number; draws: readonly DesignDraw[] };

/** Replace the shown presentations' drawn values. */
export const setDrawnValues = StateEffect.define<readonly DrawnPresentation[]>();

/** A draw call's span, and what each shown presentation drew there. */
export type DrawnMarker = {
  from: number;
  to: number;
  values: { label?: string; text: string; title: string }[];
  /** Whether the shown presentations drew different values. */
  differs: boolean;
};

/** One marker per draw call in the document, skipping spans that run past its end. */
export function drawnMarkers(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): DrawnMarker[] {
  const markers = new Map<number, DrawnMarker & { compared: Set<string> }>();
  for (const { label, seed, draws } of presentations)
    for (const draw of draws) {
      if (draw.start >= draw.end || draw.end > state.doc.length) continue;
      const marker = markers.get(draw.start) ?? {
        from: draw.start,
        to: draw.end,
        values: [],
        differs: false,
        compared: new Set<string>()
      };
      marker.values.push({
        label,
        text: valueText(draw.value),
        title: `${draw.key} = ${JSON.stringify(draw.value)}, drawn by seed ${seed}`
      });
      marker.compared.add(JSON.stringify(draw.value));
      marker.differs = marker.compared.size > 1;
      markers.set(draw.start, marker);
    }
  return [...markers.values()]
    .map(({ compared: _compared, ...marker }) => marker)
    .sort((a, b) => a.from - b.from);
}

/** A short form of a drawn value: reals to two decimals, long values cut. */
export function valueText(value: unknown): string {
  if (typeof value === 'number' && !Number.isInteger(value))
    return String(Number(value.toFixed(2)));
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}

class DrawnValuesWidget extends WidgetType {
  constructor(private readonly marker: DrawnMarker) {
    super();
  }

  eq(other: DrawnValuesWidget): boolean {
    return JSON.stringify(other.marker) === JSON.stringify(this.marker);
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = this.marker.differs
      ? 'cm-drawn-values cm-drawn-differs'
      : 'cm-drawn-values';
    for (const { label, text, title } of this.marker.values) {
      const value = document.createElement('span');
      value.className = 'cm-drawn-value';
      value.title = title;
      if (label) {
        const tag = document.createElement('span');
        tag.className = 'cm-drawn-label';
        tag.textContent = label;
        value.append(tag);
      }
      value.append(text);
      wrapper.append(value);
    }
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const drawnCall = Decoration.mark({ class: 'cm-drawn-call' });
const differingCall = Decoration.mark({ class: 'cm-drawn-call cm-drawn-differs' });

function decorations(state: EditorState, presentations: readonly DrawnPresentation[]) {
  const marks: Range<Decoration>[] = [];
  for (const marker of drawnMarkers(state, presentations)) {
    marks.push((marker.differs ? differingCall : drawnCall).range(marker.from, marker.to));
    marks.push(
      Decoration.widget({ widget: new DrawnValuesWidget(marker), side: 1 }).range(marker.to)
    );
  }
  return Decoration.set(marks, true);
}

const drawnField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setDrawnValues)) next = decorations(transaction.state, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const drawnTheme = EditorView.baseTheme({
  '.cm-drawn-call': {
    textDecoration: 'underline dotted color-mix(in oklab, #16a34a 70%, transparent)',
    textUnderlineOffset: '3px'
  },
  '.cm-drawn-differs': {
    textDecorationColor: 'color-mix(in oklab, #d97706 85%, transparent)',
    textDecorationStyle: 'solid'
  },
  '.cm-drawn-values': {
    display: 'inline-flex',
    gap: '0.25rem',
    marginLeft: '0.375rem',
    verticalAlign: 'baseline'
  },
  '.cm-drawn-value': {
    padding: '0 0.3rem',
    borderRadius: '3px',
    fontSize: '0.75rem',
    backgroundColor: 'color-mix(in oklab, #16a34a 14%, transparent)',
    color: 'var(--card-foreground)',
    cursor: 'default'
  },
  '.cm-drawn-values.cm-drawn-differs .cm-drawn-value': {
    backgroundColor: 'color-mix(in oklab, #d97706 18%, transparent)'
  },
  '.cm-drawn-label': {
    marginRight: '0.25rem',
    fontWeight: '600',
    color: 'var(--muted-foreground)'
  }
});

/** The extensions that let an editor show drawn values. */
export const drawnValues = [drawnField, drawnTheme];
