/**
 * CodeMirror markers for what a presentation's seed drew: a mark over each draw call of the design
 * block with, after it, the value each shown presentation drew there, and after each tag that
 * arranges a constraint layout, the layout each shown presentation drew, and after each <Node> tag,
 * the drawn defaults it takes.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import type { DesignDraw } from '$lib/shared/presentations';

import type { DefaultPill, TagDefaults } from './drawn-defaults';
import { tagEnd } from './selection-highlights';

/**
 * A constraint layout the step on screen drew: the line and column (both from 1) of the tag that
 * arranges it, the seed it drew from, and its form and curve when it drew them.
 */
export type DrawnLayout = {
  line: number;
  column: number;
  seed: number;
  form?: string;
  curve?: string;
};

/** What one shown presentation drew, with the label that tells it apart in a comparison. */
export type DrawnPresentation = {
  label?: string;
  seed: number;
  draws: readonly DesignDraw[];
  layouts?: readonly DrawnLayout[];
};

/** Replace the shown presentations' drawn values, and the defaults each tag takes in them. */
export const setDrawnValues = StateEffect.define<{
  presentations: readonly DrawnPresentation[];
  tags: readonly TagDefaults[];
}>();

/**
 * What each shown presentation drew at one place: a draw call, marked from `from` to `to`, or a
 * tag arranging a layout, where `from` and `to` are both just past the tag.
 */
export type DrawnMarker = {
  from: number;
  to: number;
  values: { label?: string; text: string; title: string }[];
  /** Whether the shown presentations drew different values. */
  differs: boolean;
};

/**
 * One marker per draw call and per arranging tag in the document, skipping places it does not
 * hold. A tag rendered more than once, as in an {#each}, shows each layout it drew once.
 */
export function drawnMarkers(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): DrawnMarker[] {
  const markers = new Map<number, DrawnMarker & { compared: Set<string> }>();
  const add = (
    from: number,
    to: number,
    value: DrawnMarker['values'][number],
    compared: string
  ) => {
    const marker = markers.get(from) ?? {
      from,
      to,
      values: [],
      differs: false,
      compared: new Set()
    };
    marker.values.push(value);
    marker.compared.add(compared);
    marker.differs = marker.compared.size > 1;
    markers.set(from, marker);
  };
  for (const { label, seed, draws, layouts = [] } of presentations) {
    for (const draw of draws) {
      if (draw.start >= draw.end || draw.end > state.doc.length) continue;
      add(
        draw.start,
        draw.end,
        {
          label,
          text: valueText(draw.value),
          title: `${draw.key} = ${JSON.stringify(draw.value)}, drawn by seed ${seed}`
        },
        JSON.stringify(draw.value)
      );
    }
    for (const [at, drawn] of layoutsByTag(state, layouts)) {
      const shapes = [...new Set(drawn.map(layoutText))];
      add(
        at,
        at,
        {
          label,
          text: shapes.join(', '),
          title: `Layout seeds ${[...new Set(drawn.map(({ seed: own }) => own))].join(', ')}; set layoutSeed to one to keep its layout`
        },
        JSON.stringify(shapes)
      );
    }
  }
  return [...markers.values()]
    .map(({ compared: _compared, ...marker }) => marker)
    .sort((a, b) => a.from - b.from);
}

/** A presentation's layouts grouped by the offset just past the tag that arranges them. */
function layoutsByTag(state: EditorState, layouts: readonly DrawnLayout[]) {
  const tags = new Map<number, DrawnLayout[]>();
  for (const layout of layouts) {
    if (layout.line < 1 || layout.line > state.doc.lines) continue;
    const from = state.doc.line(layout.line).from + layout.column - 1;
    if (state.doc.sliceString(from, from + 5) !== '<Node') continue;
    const at = from + tagEnd(state.doc.sliceString(from, from + 4000));
    tags.set(at, [...(tags.get(at) ?? []), layout]);
  }
  return tags;
}

/** A layout's form and curve, or that it drew neither. */
function layoutText({ form, curve }: DrawnLayout): string {
  return [form, curve].filter(Boolean).join(' ') || 'layout';
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

/** The defaults a tag takes, one pill per prop with each shown presentation's value. */
class TagDefaultsWidget extends WidgetType {
  constructor(private readonly pills: readonly DefaultPill[]) {
    super();
  }

  eq(other: TagDefaultsWidget): boolean {
    return JSON.stringify(other.pills) === JSON.stringify(this.pills);
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-drawn-values cm-drawn-defaults';
    for (const { name, values, differs } of this.pills) {
      const pill = document.createElement('span');
      pill.className = differs ? 'cm-drawn-value cm-drawn-differs' : 'cm-drawn-value';
      pill.title = values
        .map(({ label, title }) => (label ? `${label}: ${title}` : title))
        .join('\n');
      const prop = document.createElement('span');
      prop.className = 'cm-drawn-label';
      prop.textContent = name;
      pill.append(prop);
      values.forEach(({ text, color }, index) => {
        if (index) pill.append(' / ');
        if (color) {
          const swatch = document.createElement('span');
          swatch.className = 'cm-drawn-swatch';
          swatch.style.backgroundColor = color;
          pill.append(swatch);
        } else pill.append(text);
      });
      wrapper.append(pill);
    }
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** The offset just past each tag that takes defaults, with its pills, skipping tags not found. */
export function tagDefaultsAt(
  state: EditorState,
  tags: readonly TagDefaults[]
): { at: number; pills: DefaultPill[] }[] {
  return tags.flatMap(({ line, column, pills }) => {
    if (line < 1 || line > state.doc.lines || !pills.length) return [];
    const from = state.doc.line(line).from + column - 1;
    if (state.doc.sliceString(from, from + 5) !== '<Node') return [];
    return [{ at: from + tagEnd(state.doc.sliceString(from, from + 4000)), pills }];
  });
}

const drawnCall = Decoration.mark({ class: 'cm-drawn-call' });
const differingCall = Decoration.mark({ class: 'cm-drawn-call cm-drawn-differs' });

function decorations(
  state: EditorState,
  {
    presentations,
    tags
  }: { presentations: readonly DrawnPresentation[]; tags: readonly TagDefaults[] }
) {
  const marks: Range<Decoration>[] = [];
  for (const { at, pills } of tagDefaultsAt(state, tags))
    marks.push(Decoration.widget({ widget: new TagDefaultsWidget(pills), side: 2 }).range(at));
  for (const marker of drawnMarkers(state, presentations)) {
    if (marker.from < marker.to)
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
  '.cm-drawn-defaults .cm-drawn-value': {
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 12%, transparent)'
  },
  '.cm-drawn-defaults .cm-drawn-value.cm-drawn-differs': {
    backgroundColor: 'color-mix(in oklab, #d97706 18%, transparent)'
  },
  '.cm-drawn-swatch': {
    display: 'inline-block',
    width: '0.7em',
    height: '0.7em',
    borderRadius: '2px',
    border: '1px solid color-mix(in oklab, var(--card-foreground) 30%, transparent)',
    verticalAlign: 'middle'
  },
  '.cm-drawn-label': {
    marginRight: '0.25rem',
    fontWeight: '600',
    color: 'var(--muted-foreground)'
  }
});

/** The extensions that let an editor show drawn values. */
export const drawnValues = [drawnField, drawnTheme];
