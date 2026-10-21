/**
 * CodeMirror markers for what a presentation drew: inside each <Node> tag, a chip for the layout it
 * arranged from the seed, which opens it under the tag as ghost props, written as the view would
 * write them; in an editable editor, clicking a ghost value writes it as a prop. Views of a type
 * that no shown presentation's variant chose are greyed out. A presentation built while sources had
 * design blocks also marks each draw call with the value each shown presentation drew there.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import type { DesignDraw, DesignValues } from '$lib/shared/presentations';

/**
 * One prop a tag left to the seed, such as its layoutSeed, and what each visible presentation drew
 * for it; `pin` is the prop as the view would write it to keep that value, where one can.
 */
export type GhostProp = {
  name: string;
  values: { label?: string; text: string; color?: string; title: string; pin?: string }[];
  differs: boolean;
};

/** A prop as a view writes it: a text value quoted, anything else in braces. */
export function propText(name: string, value: unknown): string {
  return typeof value === 'string' ? `${name}="${value}"` : `${name}={${JSON.stringify(value)}}`;
}
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
  /** Its variant, and the views each type rendered by name could draw. */
  variant?: DesignValues;
  views?: Readonly<Record<string, readonly string[]>>;
  /** The draws of a presentation built while sources had design blocks; none for others. */
  draws: readonly DesignDraw[];
  layouts?: readonly DrawnLayout[];
};

/** Replace the shown presentations' drawn values. */
export const setDrawnValues = StateEffect.define<{
  presentations: readonly DrawnPresentation[];
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

/** A view no shown presentation drew, from its {#snippet to its {/snippet}. */
export type UnchosenView = { from: number; to: number; title: string };

/**
 * The views no shown presentation drew: each {#snippet} that is one of a type's views, chosen by no
 * shown presentation's variant, and rendered nowhere by its own name. A presentation that recorded
 * no variant leaves its views be.
 */
export function unchosenViews(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): UnchosenView[] {
  const doc = state.doc.toString();
  const blocks = snippetBlocks(doc);
  const options = new Map<string, Set<string>>();
  for (const { views = {} } of presentations)
    for (const [type, names] of Object.entries(views))
      options.set(type, new Set([...(options.get(type) ?? []), ...names]));
  const renderedElsewhere = (name: string, view: { from: number }) =>
    [...doc.matchAll(new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'gu'))].some(
      ({ index }) => doc.slice(view.from, index).trim() !== '{#snippet'
    );
  const unchosen = new Map<string, UnchosenView>();
  for (const [type, names] of options) {
    const chosen = presentations.map(({ variant }) => variant?.[`views.${type}`]);
    if (!chosen.every((name) => typeof name === 'string')) continue;
    const picked = [...new Set(chosen)].join(' and ');
    for (const name of names) {
      const view = blocks.get(name);
      if (!view || chosen.includes(name) || renderedElsewhere(name, view)) continue;
      unchosen.set(name, { ...view, title: `Not drawn: views.${type} is ${picked}` });
    }
  }
  return [...unchosen.values()].sort((a, b) => a.from - b.from);
}

/** Each named {#snippet} block of a source, from its {#snippet to the end of its {/snippet}. */
function snippetBlocks(doc: string): Map<string, { from: number; to: number }> {
  const blocks = new Map<string, { from: number; to: number }>();
  const open: { name: string; from: number }[] = [];
  for (const match of doc.matchAll(/\{#snippet\s+([A-Za-z_$][\w$]*)|\{\/snippet\}/gu)) {
    if (match[1]) open.push({ name: match[1], from: match.index });
    else {
      const block = open.pop();
      if (block) blocks.set(block.name, { from: block.from, to: match.index + match[0].length });
    }
  }
  return blocks;
}

/** How a draw's value came about, for its hover text. */
const drawSource = {
  chosen: () => 'chosen',
  kept: () => 'kept from the viewed variant',
  random: (seed: number) => `drawn by seed ${seed}`
};

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
        title: `${draw.key} = ${JSON.stringify(draw.value)}, ${drawSource[draw.origin ?? 'random'](seed)}`
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
 * The ghost props of every <Node> tag in the document: the layout it arranged (its form, curve,
 * and layoutSeed). A tag rendered more than once, as in an {#each},
 * shows each value it drew once, and can be pinned only where it drew one.
 */
export function tagGhosts(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): TagGhosts[] {
  const ghosts = new Map<number, GhostProp[]>();
  const add = (line: number, column: number, props: GhostProp[]) => {
    const at = closingAt(state, line, column);
    if (at !== undefined && props.length) ghosts.set(at, [...(ghosts.get(at) ?? []), ...props]);
  };
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

/** The chip's summary of a tag's ghost props: how many, and which ones a pair drew differently. */
export function ghostSummary(props: readonly GhostProp[]): string {
  const differing = props.filter(({ differs }) => differs).map(({ name }) => name);
  const named =
    differing.length > 3
      ? `${differing.slice(0, 2).join(', ')} +${differing.length - 2}`
      : differing.join(', ');
  return `${props.length} drawn${differing.length ? ` · ${named} differ${differing.length > 1 ? '' : 's'}` : ''}`;
}

/** Inside a tag, before its >: a chip saying what the tag left to the seed, opening its ghost props. */
class GhostChipWidget extends WidgetType {
  constructor(
    private readonly props: readonly GhostProp[],
    private readonly open: boolean
  ) {
    super();
  }

  eq(other: GhostChipWidget): boolean {
    return other.open === this.open && JSON.stringify(other.props) === JSON.stringify(this.props);
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('span');
    chip.className = this.props.some(({ differs }) => differs)
      ? 'cm-ghost-chip cm-drawn-differs'
      : 'cm-ghost-chip';
    chip.textContent = `${this.open ? '▾' : '▸'} ${ghostSummary(this.props)}`;
    chip.title = this.open
      ? 'Hide the props this tag left to the seed'
      : 'Show the props this tag left to the seed';
    chip.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleGhosts.of(view.posAtDOM(chip)) });
    });
    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Under a tag's line: its ghost props, one row each, written as the view would set them, with a
 * column per shown presentation. In an editable editor, a value with a pin writes that prop into
 * the tag at `at`, where its chip is.
 */
class GhostTableWidget extends WidgetType {
  constructor(
    private readonly props: readonly GhostProp[],
    private readonly at: number
  ) {
    super();
  }

  eq(other: GhostTableWidget): boolean {
    return other.at === this.at && JSON.stringify(other.props) === JSON.stringify(this.props);
  }

  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('div');
    table.className = 'cm-ghost-table';
    const columns = this.props[0]?.values.length ?? 1;
    table.style.gridTemplateColumns = `max-content repeat(${columns}, max-content)`;
    const cell = (className: string, text = '') => {
      const element = document.createElement('span');
      element.className = className;
      element.textContent = text;
      table.append(element);
      return element;
    };
    const labels = this.props[0]?.values.map(({ label }) => label) ?? [];
    if (labels.some(Boolean)) {
      cell('cm-ghost-name');
      for (const label of labels) cell('cm-drawn-label', label ?? '');
    }
    for (const { name, values, differs } of this.props) {
      cell(differs ? 'cm-ghost-name cm-drawn-differs' : 'cm-ghost-name', `${name}=`);
      for (const { label, text, color, title, pin } of values) {
        const value = cell(
          differs ? 'cm-ghost-value cm-drawn-differs' : 'cm-ghost-value',
          color ? '' : text
        );
        value.title = `${label ? `${label}: ` : ''}${title}${pin ? `\nWhile editing, click to write ${pin}` : ''}`;
        if (color) {
          const swatch = document.createElement('span');
          swatch.className = 'cm-drawn-swatch';
          swatch.style.backgroundColor = color;
          value.append(swatch, ` ${text}`);
        }
        if (!pin) continue;
        value.dataset.pin = pin;
        value.addEventListener('mousedown', (event) => {
          if (view.state.readOnly) return;
          event.preventDefault();
          view.dispatch({
            changes: { from: this.at, insert: ` ${pin}` },
            effects: removeGhost.of({ at: this.at, name })
          });
        });
      }
    }
    return table;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Open or close the ghost props of the tag whose chip is at a position. */
const toggleGhosts = StateEffect.define<number>();

type DrawnState = {
  markers: DrawnMarker[];
  ghosts: TagGhosts[];
  /** Where the chips of the tags whose ghost props are open are. */
  open: number[];
  unchosen: UnchosenView[];
};

const drawnCall = Decoration.mark({ class: 'cm-drawn-call' });
const differingCall = Decoration.mark({ class: 'cm-drawn-call cm-drawn-differs' });

function decorations(
  state: EditorState,
  { markers, ghosts, open, unchosen }: DrawnState
): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const { from, to, title } of unchosen)
    if (from < to)
      marks.push(Decoration.mark({ class: 'cm-unchosen', attributes: { title } }).range(from, to));
  for (const marker of markers) {
    marks.push((marker.differs ? differingCall : drawnCall).range(marker.from, marker.to));
    marks.push(
      Decoration.widget({ widget: new DrawnValuesWidget(marker), side: 1 }).range(marker.to)
    );
  }
  for (const { at, props } of ghosts) {
    if (!props.length || at > state.doc.length) continue;
    const shown = open.includes(at);
    marks.push(Decoration.widget({ widget: new GhostChipWidget(props, shown), side: 1 }).range(at));
    if (shown)
      marks.push(
        Decoration.widget({ widget: new GhostTableWidget(props, at), block: true, side: 1 }).range(
          state.doc.lineAt(at).to
        )
      );
  }
  return Decoration.set(marks, true);
}

// Markers keep their places through edits, as CodeMirror maps them, until the next set replaces them.
const drawnField = StateField.define<DrawnState>({
  create: () => ({ markers: [], ghosts: [], open: [], unchosen: [] }),
  update(value, transaction) {
    const { changes } = transaction;
    let next: DrawnState = transaction.docChanged
      ? {
          // A call the edit removed, as when the whole text is replaced, leaves no marker.
          markers: value.markers
            .map((marker) => ({
              ...marker,
              from: changes.mapPos(marker.from),
              to: changes.mapPos(marker.to)
            }))
            .filter(({ from, to }) => from < to),
          ghosts: value.ghosts.map((tag) => ({ ...tag, at: changes.mapPos(tag.at, 1) })),
          open: value.open.map((at) => changes.mapPos(at, 1)),
          unchosen: value.unchosen.map((view) => ({
            ...view,
            from: changes.mapPos(view.from),
            to: changes.mapPos(view.to)
          }))
        }
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setDrawnValues)) {
        const ghosts = tagGhosts(transaction.state, effect.value.presentations);
        next = {
          markers: drawnMarkers(transaction.state, effect.value.presentations),
          ghosts,
          // A tag stays open as the shown presentations or their steps change.
          open: next.open.filter((at) => ghosts.some((tag) => tag.at === at)),
          unchosen: unchosenViews(transaction.state, effect.value.presentations)
        };
      }
      if (effect.is(toggleGhosts)) {
        const at = changes.mapPos(effect.value, 1);
        next = {
          ...next,
          open: next.open.includes(at)
            ? next.open.filter((open) => open !== at)
            : [...next.open, at]
        };
      }
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
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => decorations(state, state.field(field)))
});

const drawnTheme = EditorView.baseTheme({
  '.cm-unchosen': { opacity: '0.4' },
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
  '.cm-ghost-chip': {
    marginLeft: '0.375rem',
    padding: '0 0.3rem',
    borderRadius: '3px',
    fontSize: '0.75rem',
    color: 'var(--muted-foreground)',
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 10%, transparent)',
    cursor: 'pointer',
    userSelect: 'none'
  },
  '.cm-ghost-chip.cm-drawn-differs': {
    backgroundColor: 'color-mix(in oklab, #d97706 18%, transparent)'
  },
  // Ghost props read as code the seed wrote, faded and slanted, with each value a pill as a draw's is.
  '.cm-ghost-table': {
    display: 'grid',
    gap: '0.15rem 0.5rem',
    alignItems: 'baseline',
    margin: '0.15rem 0 0.35rem 2rem',
    padding: '0.25rem 0.5rem',
    width: 'fit-content',
    maxWidth: 'calc(100% - 2rem)',
    borderLeft: '2px solid color-mix(in oklab, var(--muted-foreground) 25%, transparent)',
    color: 'color-mix(in oklab, var(--card-foreground) 45%, transparent)',
    fontStyle: 'italic'
  },
  '.cm-ghost-name.cm-drawn-differs': { color: 'color-mix(in oklab, #d97706 85%, transparent)' },
  '.cm-ghost-value': {
    justifySelf: 'start',
    padding: '0 0.3rem',
    borderRadius: '3px',
    fontSize: '0.75rem',
    fontStyle: 'normal',
    lineHeight: '1.35',
    color: 'var(--card-foreground)',
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 14%, transparent)',
    cursor: 'default'
  },
  '.cm-ghost-value.cm-drawn-differs': {
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
