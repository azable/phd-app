/**
 * CodeMirror markers for what a presentation drew: inside each <Node>, <Pointed>, and <Link> tag, a
 * chip naming its kind, which opens under the tag its kind's values in each shown presentation's
 * variant (and inside a <Listing />, its language and fills), and the layout it arranged from the seed as ghost props, written as the view would write
 * them; in an editable editor, clicking a layout value writes it as a prop. After each render of a
 * type, as {@render Flag(seen)}, the view each shown variant draws it with, and where the render is
 * a place, as {@render Index(@left)}, a chip opening that place's own values; the first top-level
 * node's chip also holds the page frame, which shows above the source where there is no such node.
 * Views of a type that no shown presentation's variant chose are greyed out, and so are nodes every
 * shown presentation left out (see left-out.ts). A presentation built
 * while sources had design blocks also marks each draw call with the value each shown presentation
 * drew there.
 *
 * @packageDocumentation
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import {
  colourCss,
  frameOptions,
  listingOptions,
  propOptions
} from '$lib/modes/sverlin/library/node/design';
import type { DesignDraw, DesignValues } from '$lib/shared/presentations';

/** One prop of a tag, its kind's variable, and the value each visible presentation gave it. */
export type GhostProp = {
  name: string;
  values: { label?: string; text: string; color?: string; title: string }[];
  differs: boolean;
  /** The design variable its row shows, as `Highlight.Pointed@left.fill`, which links reveal. */
  key?: string;
};

import { tagEnd } from './selection-highlights';
import {
  revealedField,
  revealedKeys,
  revealedRanges,
  revealedRegions,
  setRevealedKeys
} from './source-reveal';

/** What one shown presentation drew, with the label that tells it apart in a comparison. */
export type DrawnPresentation = {
  label?: string;
  seed: number;
  /**
   * Its variant, where each value came from, the views each type rendered by name could draw, the
   * pointer views each position type rendered as a pointer could, and the kind of each tag, by its
   * line:column.
   */
  variant?: DesignValues;
  origins?: Readonly<Record<string, string>>;
  views?: Readonly<Record<string, readonly string[]>>;
  pointers?: Readonly<Record<string, readonly string[]>>;
  kinds?: Readonly<Record<string, readonly string[]>>;
  /** The variable each render of a type by name reads, views.Int or pointers.Index, by its line:column. */
  renders?: Readonly<Record<string, string>>;
  /** The <Node> tags it left out, by their line:column; none recorded by older presentations. */
  leftOut?: readonly string[];
  /** The draws of a presentation built while sources had design blocks; none for others. */
  draws: readonly DesignDraw[];
};

/** Replace the shown presentations' drawn values. */
export const setDrawnValues = StateEffect.define<{
  presentations: readonly DrawnPresentation[];
}>();

/** What each shown presentation drew at one design-block draw call, from `from` to `to`. */
export type DrawnMarker = {
  from: number;
  to: number;
  values: { label?: string; text: string; title: string }[];
  /** Whether the shown presentations drew different values. */
  differs: boolean;
};

/**
 * The ghost props of one tag, at the offset of its closing > (or />), and its kind; or of a place, at
 * the end of the render drawn there, named by it (`@left`).
 */
export type TagGhosts = { at: number; props: GhostProp[]; kinds: string[]; place?: string };

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
  // By variable, as views.Int or pointers.Index, every view it could choose.
  const options = new Map<string, Set<string>>();
  for (const { views = {}, pointers = {} } of presentations)
    for (const [prefix, choices] of [
      ['views', views],
      ['pointers', pointers]
    ] as const)
      for (const [type, names] of Object.entries(choices))
        options.set(
          `${prefix}.${type}`,
          new Set([...(options.get(`${prefix}.${type}`) ?? []), ...names])
        );
  const renderedElsewhere = (name: string, view: { from: number }) =>
    [...doc.matchAll(new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'gu'))].some(
      ({ index }) => doc.slice(view.from, index).trim() !== '{#snippet'
    );
  const unchosen = new Map<string, UnchosenView>();
  for (const [key, names] of options) {
    const chosen = presentations.map(({ variant }) => variant?.[key]);
    if (!chosen.every((name) => typeof name === 'string')) continue;
    const picked = [...new Set(chosen)].join(' and ');
    // A place's own choice of the type, as views.Int@swap.held or views.Ask.Int@g.a, draws its view.
    const [prefix, type] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
    const atPlaces = presentations.flatMap(({ variant = {} }) =>
      Object.entries(variant).flatMap(([other, value]) =>
        other.startsWith(`${prefix}.`) &&
        other.includes('@') &&
        other
          .slice(prefix.length + 1, other.indexOf('@'))
          .split('.')
          .at(-1) === type
          ? [value]
          : []
      )
    );
    for (const name of names) {
      const view = blocks.get(name);
      if (
        !view ||
        chosen.includes(name) ||
        atPlaces.includes(name) ||
        renderedElsewhere(name, view)
      )
        continue;
      unchosen.set(name, { ...view, title: `Not drawn: ${key} is ${picked}` });
    }
  }
  return [...unchosen.values()].sort((a, b) => a.from - b.from);
}

/**
 * The <Node> tags every shown presentation left out, each from its opening tag to the end of its
 * closing one. Where a presentation recorded none, as older ones, nothing is left out.
 */
export function leftOutNodes(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): UnchosenView[] {
  if (!presentations.length || presentations.some(({ leftOut }) => !leftOut)) return [];
  const [first, ...others] = presentations.map(({ leftOut }) => new Set(leftOut));
  const doc = state.doc.toString();
  const nodes: UnchosenView[] = [];
  for (const site of first) {
    if (others.some((set) => !set.has(site))) continue;
    const [line, column] = site.split(':').map(Number);
    if (!(line >= 1 && line <= state.doc.lines)) continue;
    const from = state.doc.line(line).from + column - 1;
    if (!doc.startsWith('<Node', from)) continue;
    nodes.push({
      from,
      to: nodeEnd(doc, from),
      title: 'Not drawn: left out of every shown presentation'
    });
  }
  // A node inside another left out is greyed once, with it.
  return nodes
    .sort((a, b) => a.from - b.from)
    .filter(
      (node) =>
        !nodes.some((outer) => outer !== node && outer.from <= node.from && node.to <= outer.to)
    );
}

/** Where the <Node> starting at `from` ends: after its closing tag, or its own if it closes itself. */
function nodeEnd(doc: string, from: number): number {
  const opening = from + tagEnd(doc.slice(from));
  if (doc[opening - 2] === '/') return opening;
  let depth = 1;
  const tags = /<Node(?![\w$])|<\/Node\s*>/gu;
  tags.lastIndex = opening;
  for (let match = tags.exec(doc); match; match = tags.exec(doc)) {
    if (match[0].startsWith('</')) {
      depth--;
      if (!depth) return match.index + match[0].length;
    } else if (doc[match.index + tagEnd(doc.slice(match.index)) - 2] !== '/') depth++;
  }
  return opening;
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

/** Where a value of a presentation's variant came from, for its hover text. */
const originText: Record<string, string> = {
  chosen: 'chosen',
  kept: 'kept from the viewed variant',
  random: 'randomised',
  starter: 'from the starter'
};

// Variables in a fixed order, as stored variants may come back with their keys reordered.
const propOrder = Object.keys(propOptions);
const frameOrder = Object.keys(frameOptions);
const listingOrder = Object.keys(listingOptions);
const byOrder = (order: readonly string[], of: (key: string) => string) => (a: string, b: string) =>
  order.indexOf(of(a)) - order.indexOf(of(b)) || a.localeCompare(b);

/** One variable, as each shown presentation's variant has it, named as its row shows it. */
function variable(
  presentations: readonly DrawnPresentation[],
  key: string,
  name: string
): GhostProp {
  const values = presentations.map(({ label, variant = {}, origins = {} }) => {
    const value = variant[key];
    const origin = origins[key];
    const colour = colourCss(value);
    return {
      label,
      text: value === undefined ? '–' : String(value),
      title: `${key} = ${value === undefined ? 'none recorded' : String(value)}${origin ? `, ${originText[origin] ?? origin}` : ''}`,
      ...(colour ? { color: colour } : {})
    };
  });
  return { name, values, differs: new Set(values.map(({ text }) => text)).size > 1, key };
}

/**
 * The ghost props of every <Node>, <Pointed>, and <Link> tag in the document: its kind's values in
 * each shown presentation's variant, a tag of several kinds, as across sources, naming each by its kind.
 */
export function tagGhosts(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): TagGhosts[] {
  const ghosts = new Map<number, { props: GhostProp[]; kinds: string[] }>();
  const add = (line: number, column: number, props: GhostProp[], kinds: string[] = []) => {
    const at = closingAt(state, line, column);
    if (at === undefined || !props.length) return;
    const known = ghosts.get(at) ?? { props: [], kinds: [] };
    ghosts.set(at, {
      props: [...known.props, ...props],
      kinds: [...new Set([...known.kinds, ...kinds])]
    });
  };
  const tagged = new Map<string, Set<string>>();
  for (const { kinds = {} } of presentations)
    for (const [position, keys] of Object.entries(kinds))
      tagged.set(position, new Set([...(tagged.get(position) ?? []), ...keys]));
  for (const [position, keys] of tagged) {
    const [line, column] = position.split(':').map(Number);
    const props = [...keys].flatMap((kind) =>
      [
        ...new Set(
          presentations.flatMap(({ variant = {} }) =>
            // A place's variables are its render's (see placeGhosts), not its kind's tag's.
            Object.keys(variant).filter((key) => key.startsWith(`${kind}.`) && !key.includes('@'))
          )
        )
      ]
        .sort(byOrder(propOrder, (key) => key.slice(kind.length + 1)))
        .map((key) =>
          variable(presentations, key, keys.size > 1 ? key : key.slice(kind.length + 1))
        )
    );
    add(line, column, props, [...keys]);
  }
  // A listing's settings are its tag's, as a kind's are its nodes'.
  const doc = state.doc.toString();
  const listingProps = listingSettings(presentations);
  if (listingProps.length)
    for (const match of doc.matchAll(/<Listing\b/gu)) {
      const line = state.doc.lineAt(match.index);
      add(line.number, match.index - line.from + 1, listingProps, ['listing']);
    }
  return [...ghosts]
    .map(([at, { props, kinds }]) => ({ at, props, kinds }))
    .sort((a, b) => a.at - b.at);
}

/** A render's argument that makes it a place: a label, a variable, or a field, as written. */
const placeArgument = /^@?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/u;

/** Each {#snippet} of a source, from its {#snippet to its {/snippet}, and whether it takes a value. */
function snippetRanges(doc: string): { name: string; from: number; to: number; typed: boolean }[] {
  const ranges: { name: string; from: number; to: number; typed: boolean }[] = [];
  const open: { name: string; from: number; typed: boolean }[] = [];
  for (const match of doc.matchAll(
    /\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\{\/snippet\}/gu
  )) {
    if (match[1]) open.push({ name: match[1], from: match.index, typed: match[2].trim() !== '' });
    else {
      const block = open.pop();
      if (block) ranges.push({ ...block, to: match.index + match[0].length });
    }
  }
  return ranges;
}

/** Where a tag that opens with { at `from` closes, after its }, or undefined. */
function braceEnd(doc: string, from: number): number | undefined {
  let depth = 0;
  for (let at = from; at < doc.length; at++) {
    if (doc[at] === '{') depth++;
    if (doc[at] === '}' && --depth === 0) return at + 1;
  }
  return undefined;
}

/**
 * A place's own values, as each shown presentation's variant has them, after the render drawn there,
 * as {@render Index(@left)}: its own view choice, where it has one, and the paint of the kinds of
 * the view it draws with, as `Highlight.Pointed@left.fill`. A place is named by the argument as
 * written, inside a typed view after that view's path (`Ask.IntCell@g.a`), as the build names it.
 */
export function placeGhosts(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): TagGhosts[] {
  const keys = [
    ...new Set(
      presentations.flatMap(({ variant = {} }) =>
        Object.keys(variant).filter((key) => key.includes('@'))
      )
    )
  ];
  if (!keys.length) return [];
  const doc = state.doc.toString();
  const snippets = snippetRanges(doc);
  const ghosts: TagGhosts[] = [];
  for (const match of doc.matchAll(/\{@render\s+([A-Za-z_$][\w$]*)\s*\(/gu)) {
    const type = match[1];
    const opened = match.index + match[0].length;
    let close = opened;
    for (let depth = 1; close < doc.length && depth; close++)
      if (doc[close] === '(') depth++;
      else if (doc[close] === ')') depth--;
    const place = placeArgument.exec(doc.slice(opened, close - 1).trim())?.[1];
    const end = braceEnd(doc, match.index);
    if (!place || end === undefined) continue;
    // In a typed view, a place's variables carry the view's path; at the top level or in a part,
    // none.
    const around = snippets
      .filter(({ from, to }) => from < match.index && match.index < to)
      .sort((a, b) => a.from - b.from);
    const typed = around.findLastIndex((snippet) => snippet.typed);
    const prefixes =
      typed < 0
        ? ['']
        : [
            ...new Set([
              `${around
                .slice(0, typed + 1)
                .map(({ name }) => name)
                .join('.')}.`,
              `${around[typed].name}.`
            ])
          ];
    const views = new Set(
      presentations.flatMap(({ views = {}, pointers = {} }) => [
        ...(views[type] ?? []),
        ...(pointers[type] ?? [])
      ])
    );
    const choices = keys.filter((key) => {
      const at = key.indexOf('@');
      const head = key.slice(0, at);
      return (
        /^(?:views|pointers)\./u.test(head) &&
        key.slice(at + 1) === place &&
        prefixes.some((prefix) => head.slice(head.indexOf('.') + 1) === `${prefix}${type}`)
      );
    });
    // The view this render draws with in each presentation: the place's own choice, else what the
    // build records it reads.
    const line = state.doc.lineAt(match.index);
    const site = `${line.number}:${match.index - line.from + 1}`;
    const drawnWith = new Set(
      presentations.flatMap(({ variant = {}, renders = {} }) => {
        const choice = choices
          .map((key) => variant[key])
          .find((value) => typeof value === 'string');
        const read = renders[site];
        const value = choice ?? (read ? variant[read] : undefined);
        return typeof value === 'string' ? [value] : [];
      })
    );
    const kindOf = (key: string) => {
      const at = key.indexOf('@');
      const rest = key.slice(at + 1);
      const dot = rest.lastIndexOf('.');
      if (dot < 0 || rest.slice(0, dot) !== place || !paintProps.has(rest.slice(dot + 1)))
        return undefined;
      const head = key.slice(0, at);
      for (const prefix of prefixes) {
        if (!head.startsWith(prefix)) continue;
        const kind = head.slice(prefix.length);
        const view = [...views].find((name) => kind === name || kind.startsWith(`${name}.`));
        if (view && (!drawnWith.size || drawnWith.has(view))) return kind;
      }
      return undefined;
    };
    const paint = keys
      .flatMap((key) => {
        const kind = kindOf(key);
        return kind ? [{ key, kind, prop: key.slice(key.lastIndexOf('.') + 1) }] : [];
      })
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || propOrder.indexOf(a.prop) - propOrder.indexOf(b.prop)
      );
    const props = [
      ...choices.map((key) => variable(presentations, key, choices.length > 1 ? key : 'view')),
      ...paint.map(({ key, kind, prop }) => variable(presentations, key, `${kind}.${prop}`))
    ];
    if (props.length) ghosts.push({ at: end, props, kinds: [`@${place}`], place: `@${place}` });
  }
  return ghosts;
}

/** The props a place sets of its own: what tells one render apart. */
const paintProps = new Set(['shown', 'fill', 'stroke', 'color']);

/**
 * The page frame's settings in each shown presentation's variant, each named by its setting, then
 * where the steps pause, each named by its variable, the label's full name, as
 * pause@insert.swap.to.
 */
export function frameProps(presentations: readonly DrawnPresentation[]): GhostProp[] {
  const keys = new Set(
    presentations.flatMap(({ variant = {} }) =>
      Object.keys(variant).filter((key) => key.startsWith('frame.'))
    )
  );
  const pauses = [
    ...new Set(
      presentations.flatMap(({ variant = {} }) =>
        Object.keys(variant).filter((key) => key.startsWith('pause@'))
      )
    )
  ].sort();
  return [
    ...[...keys]
      .sort(byOrder(frameOrder, (key) => key))
      .map((key) => variable(presentations, key, key.slice('frame.'.length))),
    ...pauses.map((key) => variable(presentations, key, key))
  ];
}

/**
 * A listing's settings in each shown presentation's variant: its language, then its lit look, then
 * each region's paint, by its label's full name, as lit@insert.compare.left.fill.
 */
function listingSettings(presentations: readonly DrawnPresentation[]): GhostProp[] {
  const keys = new Set(
    presentations.flatMap(({ variant = {} }) =>
      Object.keys(variant).filter((key) => key.startsWith('listing.'))
    )
  );
  const own = [...keys].filter((key) => !key.includes('@'));
  const regions = [...keys].filter((key) => key.includes('@')).sort();
  return [...own.sort(byOrder(listingOrder, (key) => key)), ...regions].map((key) =>
    variable(presentations, key, key.slice('listing.'.length))
  );
}

/**
 * After each render of a type by name, as {@render Flag(v.seen)}, the view each shown presentation's
 * variant draws it with.
 */
export function viewMarkers(
  state: EditorState,
  presentations: readonly DrawnPresentation[]
): DrawnMarker[] {
  const doc = state.doc.toString();
  const keys = new Set(
    presentations.flatMap(({ variant = {} }) =>
      Object.keys(variant).filter((key) => key.startsWith('views.') || key.startsWith('pointers.'))
    )
  );
  const markers: DrawnMarker[] = [];
  for (const match of doc.matchAll(/\{@render\s+([A-Za-z_$][\w$]*)\s*\(/gu)) {
    // The variable the build says this render reads: a position type's number or its mark.
    const line = state.doc.lineAt(match.index);
    const site = `${line.number}:${match.index - line.from + 1}`;
    const read = presentations.map(({ renders }) => renders?.[site]).find(Boolean);
    const chosen =
      read && keys.has(read)
        ? read
        : keys.has(`views.${match[1]}`)
          ? `views.${match[1]}`
          : undefined;
    if (!chosen) continue;
    // The tag ends at the brace that closes its own.
    let depth = 0;
    let to = match.index;
    for (; to < doc.length; to++) {
      if (doc[to] === '{') depth++;
      if (doc[to] === '}' && --depth === 0) break;
    }
    if (to >= doc.length) continue;
    const { values, differs } = variable(presentations, chosen, match[1]);
    markers.push({ from: match.index, to: to + 1, values, differs });
  }
  return markers;
}

/**
 * Where a <Node>, <Pointed>, <Link>, or <Listing> tag's props end, before its closing > or />, or
 * undefined if none is there.
 */
function closingAt(state: EditorState, line: number, column: number): number | undefined {
  if (line < 1 || line > state.doc.lines) return undefined;
  const from = state.doc.line(line).from + column - 1;
  if (!/^<(?:Node|Pointed|Link|Listing)\b/u.test(state.doc.sliceString(from, from + 9)))
    return undefined;
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
  constructor(
    private readonly marker: DrawnMarker,
    /** Whether a revealed region covers the call it follows, which it then flashes with. */
    private readonly revealed = false
  ) {
    super();
  }

  eq(other: DrawnValuesWidget): boolean {
    return (
      other.revealed === this.revealed &&
      JSON.stringify(other.marker) === JSON.stringify(this.marker)
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = [
      'cm-drawn-values',
      this.marker.differs && 'cm-drawn-differs',
      this.revealed && 'cm-revealed-marker'
    ]
      .filter(Boolean)
      .join(' ');
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
 * The chip's summary of a tag's ghost props: its kinds, or how many props it drew, and which ones a
 * pair has differently.
 */
export function ghostSummary(props: readonly GhostProp[], kinds: readonly string[] = []): string {
  const differing = props.filter(({ differs }) => differs).map(({ name }) => name);
  const named =
    differing.length > 3
      ? `${differing.slice(0, 2).join(', ')} +${differing.length - 2}`
      : differing.join(', ');
  const what = !kinds.length
    ? `${props.length} drawn`
    : kinds.length > 2
      ? `${kinds[0]} +${kinds.length - 1}`
      : kinds.join(' / ');
  return `${what}${differing.length ? ` · ${named} differ${differing.length > 1 ? '' : 's'}` : ''}`;
}

/** Inside a tag, before its >: a chip naming its kind, opening its ghost props; after a place's render, its place. */
class GhostChipWidget extends WidgetType {
  constructor(
    private readonly props: readonly GhostProp[],
    private readonly open: boolean,
    private readonly kinds: readonly string[],
    private readonly place?: string
  ) {
    super();
  }

  eq(other: GhostChipWidget): boolean {
    return (
      other.open === this.open &&
      other.place === this.place &&
      JSON.stringify([other.props, other.kinds]) === JSON.stringify([this.props, this.kinds])
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('span');
    chip.className = this.props.some(({ differs }) => differs)
      ? 'cm-ghost-chip cm-drawn-differs'
      : 'cm-ghost-chip';
    chip.textContent = `${this.open ? '▾' : '▸'} ${ghostSummary(this.props, this.kinds)}`;
    chip.title = this.place
      ? `${this.open ? 'Hide' : 'Show'} this render's own look at ${this.place} in each shown variant`
      : `${this.open ? 'Hide' : 'Show'} this tag's look in each shown variant, and the layout it drew`;
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
 * column per shown presentation.
 */
class GhostTableWidget extends WidgetType {
  constructor(
    private readonly props: readonly GhostProp[],
    private readonly at: number,
    /** The design variables revealed, whose rows flash. */
    private readonly revealed: readonly string[] = []
  ) {
    super();
  }

  eq(other: GhostTableWidget): boolean {
    return (
      other.at === this.at &&
      JSON.stringify([other.props, other.revealed]) === JSON.stringify([this.props, this.revealed])
    );
  }

  toDOM(): HTMLElement {
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
    for (const { name, values, differs, key } of this.props) {
      const shown = key !== undefined && this.revealed.includes(key) ? ' cm-revealed-row' : '';
      const named = cell(
        `${differs ? 'cm-ghost-name cm-drawn-differs' : 'cm-ghost-name'}${shown}`,
        `${name}=`
      );
      if (key) named.dataset.key = key;
      for (const { label, text, color, title } of values) {
        const value = cell(
          `${differs ? 'cm-ghost-value cm-drawn-differs' : 'cm-ghost-value'}${shown}`,
          color ? '' : text
        );
        value.title = `${label ? `${label}: ` : ''}${title}`;
        if (color) {
          const swatch = document.createElement('span');
          swatch.className = 'cm-drawn-swatch';
          swatch.style.backgroundColor = color;
          value.append(swatch, ` ${text}`);
        }
      }
    }
    return table;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Above the source: the view each type draws and the page frame, as pills that wrap, each with
 * every shown presentation's value where they differ.
 */
class StripWidget extends WidgetType {
  constructor(
    private readonly props: readonly GhostProp[],
    private readonly revealed: readonly string[] = []
  ) {
    super();
  }

  eq(other: StripWidget): boolean {
    return (
      JSON.stringify([other.props, other.revealed]) === JSON.stringify([this.props, this.revealed])
    );
  }

  toDOM(): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'cm-design-strip';
    for (const { name, values, differs, key } of this.props) {
      const pill = document.createElement('span');
      pill.className = [
        'cm-ghost-value',
        differs && 'cm-drawn-differs',
        key !== undefined && this.revealed.includes(key) && 'cm-revealed-row'
      ]
        .filter(Boolean)
        .join(' ');
      if (key) pill.dataset.key = key;
      pill.title = values
        .map(({ label, title }) => `${label ? `${label}: ` : ''}${title}`)
        .join('\n');
      const shown = differs ? values.map(({ text }) => text).join(' / ') : values[0]?.text;
      pill.textContent = `${name} ${shown ?? ''}`;
      strip.append(pill);
    }
    return strip;
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
  /** The view each type draws and the page frame, in each shown variant. */
  strip: GhostProp[];
  /** Where the chips of the tags whose ghost props are open are. */
  open: number[];
  unchosen: UnchosenView[];
};

const drawnCall = Decoration.mark({ class: 'cm-drawn-call' });
const differingCall = Decoration.mark({ class: 'cm-drawn-call cm-drawn-differs' });

function decorations(
  state: EditorState,
  { markers, ghosts, strip, open, unchosen }: DrawnState
): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const keys = revealedKeys(state);
  if (strip.length)
    marks.push(
      Decoration.widget({ widget: new StripWidget(strip, keys), block: true, side: -1 }).range(0)
    );
  for (const { from, to, title } of unchosen)
    if (from < to)
      marks.push(Decoration.mark({ class: 'cm-unchosen', attributes: { title } }).range(from, to));
  const revealed = revealedRanges(state);
  for (const marker of markers) {
    marks.push((marker.differs ? differingCall : drawnCall).range(marker.from, marker.to));
    const covered = revealed.some(({ from, to }) => from <= marker.from && marker.to <= to);
    marks.push(
      Decoration.widget({ widget: new DrawnValuesWidget(marker, covered), side: 1 }).range(
        marker.to
      )
    );
  }
  for (const { at, props, kinds, place } of ghosts) {
    if (!props.length || at > state.doc.length) continue;
    const shown = open.includes(at);
    // A place's chip follows the view marker after its render.
    marks.push(
      Decoration.widget({
        widget: new GhostChipWidget(props, shown, kinds, place),
        side: place ? 2 : 1
      }).range(at)
    );
    if (shown)
      marks.push(
        Decoration.widget({
          widget: new GhostTableWidget(
            props,
            at,
            keys.filter((key) => props.some((prop) => prop.key === key))
          ),
          block: true,
          side: 1
        }).range(state.doc.lineAt(at).to)
      );
  }
  return Decoration.set(marks, true);
}

// Markers keep their places through edits, as CodeMirror maps them, until the next set replaces them.
const drawnField = StateField.define<DrawnState>({
  create: () => ({ markers: [], ghosts: [], strip: [], open: [], unchosen: [] }),
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
          strip: value.strip,
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
        const ghosts = [
          ...tagGhosts(transaction.state, effect.value.presentations),
          ...placeGhosts(transaction.state, effect.value.presentations)
        ].sort((a, b) => a.at - b.at);
        next = {
          markers: [
            ...drawnMarkers(transaction.state, effect.value.presentations),
            ...viewMarkers(transaction.state, effect.value.presentations)
          ].sort((a, b) => a.from - b.from),
          ghosts,
          // The frame belongs to no tag, so it shows above the source.
          strip: frameProps(effect.value.presentations),
          // A tag stays open as the shown presentations or their steps change.
          open: next.open.filter((at) => ghosts.some((tag) => tag.at === at)),
          unchosen: [
            ...unchosenViews(transaction.state, effect.value.presentations),
            ...leftOutNodes(transaction.state, effect.value.presentations)
          ].sort((a, b) => a.from - b.from)
        };
      }
      // A revealed variable opens the ghost props holding its row.
      if (effect.is(setRevealedKeys)) {
        const holding = next.ghosts
          .filter(({ props }) => props.some(({ key }) => key && effect.value.includes(key)))
          .map(({ at }) => at);
        next = { ...next, open: [...new Set([...next.open, ...holding])] };
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
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field, revealedField], (state) =>
      decorations(state, state.field(field))
    )
});

/**
 * Where the first row of these design variables is: the line its ghost props open under, or the top
 * of the source for a page-frame pill; undefined where none has a row.
 */
export function ghostRowAt(state: EditorState, keys: readonly string[]): number | undefined {
  const drawn = state.field(drawnField, false);
  if (!drawn || !keys.length) return undefined;
  const ghost = drawn.ghosts.find(({ props }) =>
    props.some(({ key }) => key && keys.includes(key))
  );
  if (ghost && ghost.at <= state.doc.length) return state.doc.lineAt(ghost.at).to;
  return drawn.strip.some(({ key }) => key && keys.includes(key)) ? 0 : undefined;
}

const drawnTheme = EditorView.baseTheme({
  '.cm-unchosen': { opacity: '0.4' },
  // Kept in view and wrapping, however wide long lines make the content.
  '.cm-design-strip': {
    position: 'sticky',
    left: '0',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.25rem',
    maxWidth: '44rem',
    padding: '0.25rem 0.5rem 0.35rem'
  },
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
export const drawnValues = [drawnField, drawnTheme, revealedRegions];
