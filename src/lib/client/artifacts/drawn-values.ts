/**
 * CodeMirror markers for what a presentation's seed drew: a mark over each draw call of the design
 * block with, after it, the value each shown presentation drew there; and inside each <Node> tag,
 * ghost props for what it left to the seed, its drawn defaults and the layout it arranged, written
 * as the view would write them. In an editable editor, clicking a ghost value writes it as a prop.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import type { DesignDraw } from '$lib/shared/presentations';

import { propText, type GhostProp, type TagDefaults } from './drawn-defaults';
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

/** Remove one ghost prop, once it has been written into the source. */
const removeGhost = StateEffect.define<{ at: number; name: string }>();

/** What each shown presentation drew at one design-block draw call, from `from` to `to`. */
export type DrawnMarker = {
  from: number;
  to: number;
  values: { label?: string; text: string; title: string }[];
  /** Whether the shown presentations drew different values. */
  differs: boolean;
};

/** The ghost props of one tag, at the offset of its closing > (or />). */
export type TagGhosts = { at: number; props: GhostProp[] };

/** One marker per draw call in the document, skipping spans it does not hold. */
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

/**
 * The ghost props of every <Node> tag in the document: the defaults it takes, then the layout it
 * arranged (its form, curve, and layoutSeed). A tag rendered more than once, as in an {#each},
 * shows each value it drew once, and can be pinned only where it drew one.
 */
export function tagGhosts(
  state: EditorState,
  presentations: readonly DrawnPresentation[],
  tags: readonly TagDefaults[]
): TagGhosts[] {
  const ghosts = new Map<number, GhostProp[]>();
  const add = (line: number, column: number, props: GhostProp[]) => {
    const at = closingAt(state, line, column);
    if (at !== undefined && props.length) ghosts.set(at, [...(ghosts.get(at) ?? []), ...props]);
  };
  for (const { line, column, props } of tags) add(line, column, props);
  const arranged = new Map<string, { line: number; column: number }>();
  for (const { layouts = [] } of presentations)
    for (const { line, column } of layouts) arranged.set(`${line}:${column}`, { line, column });
  for (const { line, column } of arranged.values()) {
    const drawn = presentations.map(({ label, layouts = [] }) => ({
      label,
      layouts: layouts.filter((layout) => layout.line === line && layout.column === column)
    }));
    const prop = (name: 'form' | 'curve' | 'layoutSeed'): GhostProp | undefined => {
      const values = drawn.map(({ label, layouts }) => {
        const distinct = [
          ...new Set(layouts.map((layout) => (name === 'layoutSeed' ? layout.seed : layout[name])))
        ].filter((value) => value !== undefined);
        if (!distinct.length) return { label, text: '–', title: `No ${name} drawn here` };
        return {
          label,
          text: distinct.length > 1 ? `${distinct.length} values` : String(distinct[0]),
          title: `${name}: ${distinct.join(', ')}`,
          ...(distinct.length === 1 ? { pin: propText(name, distinct[0]) } : {})
        };
      });
      if (values.every(({ text }) => text === '–')) return undefined;
      // Seeds differ wherever they are not pinned, so a pair is compared by its forms and curves.
      const differs = name !== 'layoutSeed' && new Set(values.map(({ text }) => text)).size > 1;
      return { name, values, differs };
    };
    add(
      line,
      column,
      (['form', 'curve', 'layoutSeed'] as const).flatMap((name) => prop(name) ?? [])
    );
  }
  return [...ghosts].map(([at, props]) => ({ at, props })).sort((a, b) => a.at - b.at);
}

/** Where a <Node> tag's props end, before its closing > or />, or undefined if none is there. */
function closingAt(state: EditorState, line: number, column: number): number | undefined {
  if (line < 1 || line > state.doc.lines) return undefined;
  const from = state.doc.line(line).from + column - 1;
  if (state.doc.sliceString(from, from + 5) !== '<Node') return undefined;
  const end = from + tagEnd(state.doc.sliceString(from, from + 4000));
  if (state.doc.sliceString(end - 1, end) !== '>') return undefined;
  let at = state.doc.sliceString(end - 2, end - 1) === '/' ? end - 2 : end - 1;
  // Before any space ahead of the >, so a prop written there reads name="value" />.
  while (at > from && /\s/u.test(state.doc.sliceString(at - 1, at))) at--;
  return at;
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

/**
 * A tag's ghost props, written as props: name= and each value as a pill, a pair's side by side. In an
 * editable editor, a value with a pin writes that prop into the tag where the ghost was.
 */
class GhostPropsWidget extends WidgetType {
  constructor(private readonly props: readonly GhostProp[]) {
    super();
  }

  eq(other: GhostPropsWidget): boolean {
    return JSON.stringify(other.props) === JSON.stringify(this.props);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-ghost-props';
    for (const { name, values, differs } of this.props) {
      const prop = document.createElement('span');
      prop.className = differs ? 'cm-ghost-prop cm-drawn-differs' : 'cm-ghost-prop';
      prop.append(` ${name}=`);
      for (const { label, text, color, title, pin } of values) {
        const value = document.createElement('span');
        value.className = 'cm-ghost-value';
        value.title = `${label ? `${label}: ` : ''}${title}${pin ? `\nWhile editing, click to write ${pin}` : ''}`;
        if (color) {
          const swatch = document.createElement('span');
          swatch.className = 'cm-drawn-swatch';
          swatch.style.backgroundColor = color;
          value.append(swatch);
        } else value.append(text);
        if (pin) {
          value.dataset.pin = pin;
          value.addEventListener('mousedown', (event) => {
            if (view.state.readOnly) return;
            event.preventDefault();
            const at = view.posAtDOM(wrapper);
            view.dispatch({
              changes: { from: at, insert: ` ${pin}` },
              effects: removeGhost.of({ at, name })
            });
          });
        }
        prop.append(value);
      }
      wrapper.append(prop);
    }
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

type DrawnState = { markers: DrawnMarker[]; ghosts: TagGhosts[] };

const drawnCall = Decoration.mark({ class: 'cm-drawn-call' });
const differingCall = Decoration.mark({ class: 'cm-drawn-call cm-drawn-differs' });

function decorations({ markers, ghosts }: DrawnState): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const marker of markers) {
    marks.push((marker.differs ? differingCall : drawnCall).range(marker.from, marker.to));
    marks.push(
      Decoration.widget({ widget: new DrawnValuesWidget(marker), side: 1 }).range(marker.to)
    );
  }
  for (const { at, props } of ghosts)
    if (props.length)
      marks.push(Decoration.widget({ widget: new GhostPropsWidget(props), side: 1 }).range(at));
  return Decoration.set(marks, true);
}

// Markers keep their places through edits, as CodeMirror maps them, until the next set replaces them.
const drawnField = StateField.define<DrawnState>({
  create: () => ({ markers: [], ghosts: [] }),
  update(value, transaction) {
    const { changes } = transaction;
    let next: DrawnState = transaction.docChanged
      ? {
          markers: value.markers.map((marker) => ({
            ...marker,
            from: changes.mapPos(marker.from),
            to: changes.mapPos(marker.to)
          })),
          ghosts: value.ghosts.map((tag) => ({ ...tag, at: changes.mapPos(tag.at, 1) }))
        }
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setDrawnValues))
        next = {
          markers: drawnMarkers(transaction.state, effect.value.presentations),
          ghosts: tagGhosts(transaction.state, effect.value.presentations, effect.value.tags)
        };
      if (effect.is(removeGhost)) {
        const at = changes.mapPos(effect.value.at, 1);
        next = {
          ...next,
          ghosts: next.ghosts.map((tag) =>
            tag.at === at
              ? { ...tag, props: tag.props.filter(({ name }) => name !== effect.value.name) }
              : tag
          )
        };
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, decorations)
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
  },
  // Ghost props read as code the seed wrote, faded and slanted, with each value a pill as a draw's is.
  '.cm-ghost-props': {
    color: 'color-mix(in oklab, var(--card-foreground) 45%, transparent)',
    fontStyle: 'italic'
  },
  '.cm-ghost-value': {
    display: 'inline-block',
    marginRight: '0.15rem',
    padding: '0 0.3rem',
    borderRadius: '3px',
    fontSize: '0.75rem',
    fontStyle: 'normal',
    lineHeight: '1.35',
    color: 'var(--card-foreground)',
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 14%, transparent)',
    cursor: 'default'
  },
  '.cm-ghost-prop.cm-drawn-differs .cm-ghost-value': {
    backgroundColor: 'color-mix(in oklab, #d97706 20%, transparent)'
  },
  '.cm-content[contenteditable="true"] .cm-ghost-value[data-pin]:hover': {
    cursor: 'pointer',
    outline: '1px solid color-mix(in oklab, var(--card-foreground) 40%, transparent)'
  },
  '.cm-drawn-swatch': {
    display: 'inline-block',
    width: '0.7em',
    height: '0.7em',
    borderRadius: '2px',
    border: '1px solid color-mix(in oklab, var(--card-foreground) 30%, transparent)',
    verticalAlign: 'middle'
  }
});

/** The extensions that let an editor show drawn values. */
export const drawnValues = [drawnField, drawnTheme];
