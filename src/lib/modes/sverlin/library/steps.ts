/**
 * A presentation's recorded states as the view draws them: what each step's frame is drawn with,
 * its props and the contexts it reads, worked out from the states alone, so the page and the server
 * (see ../assembly/entry.ts and ../assembly/layout.ts) draw a step alike.
 */

import type { DesignValues, ListingPlacesLook } from './node/design';
import type { FrameSettings } from './node/props';
import type { LayoutMemory } from './type-context';

export type StepState = Record<string, unknown> & {
  __types?: Record<string, string>;
  __targets?: Record<string, string>;
  __identities?: Record<string, number>;
  __copies?: Record<number, number>;
  __refs?: Record<string, number>;
  /** Variables out of scope at the step, standing in hidden with a value from another. */
  __absent?: string[];
  /** The presentation's variant: every variable of its design, by key. */
  __design: DesignValues;
  __frame: FrameSettings;
  /** The <Node> tags and renders it leaves out, by their line:column (see left-out.ts). */
  __leftOut?: string[];
  /** The <Node> tags hidden at this step, keeping their room (see hiddenAt in left-out.ts). */
  __hiddenSites?: string[];
};

/** The component's atomic types by name, as its domain block defines them. */
export type Atoms = Record<string, { parent?: string; unit?: string; places?: number }>;

/** The listing in the variant's language, and what each step lights, if the view places one. */
export type StepListing = {
  text: string;
  regions: { label: string; start: number; end: number }[];
  lit: [number, number][][];
  /** Where its tokens name places the variant lights: those places, and which each step touches. */
  places?: ListingPlaces & { touched: string[][] };
  /** Its keywords to draw in bold, and with colour every kind of word in its colour too. */
  syntax?: ListingSyntax;
} | null;

/** A listing's syntax as the page draws it (see listing/syntax.ts). */
export type ListingSyntax = {
  colour: boolean;
  spans: { kind: 'keyword' | 'string' | 'comment' | 'number'; start: number; end: number }[];
};

/**
 * A listing's tokens, each naming a place (see listing/places.server.ts), how a place lights
 * (listing.places), and the colour each place lights in and outlines its references in, design
 * colours.
 */
export type ListingPlaces = {
  look: Exclude<ListingPlacesLook, 'none'>;
  tokens: { place: string; start: number; end: number }[];
  paints: Record<string, string>;
  lines?: Record<string, string>;
  /** A label's place as a text's token writes it, as :@front, by its full name, :@insert.front. */
  aliases?: Record<string, string>;
};

/**
 * Measuring draws each step's markup, recording makes the layouts from it on the layout model, and
 * showing mounts a step with them.
 */
export type Phase = 'measuring' | 'recording' | 'showing';

/** The layouts every step is drawn with (see LayoutMemory), kept from one step to the next. */
export type Layouts = Omit<LayoutMemory, 'step' | 'measuring' | 'probing'>;

export function emptyLayouts(): Layouts {
  return {
    scopes: new Map(),
    fits: new Map(),
    reserved: new Map(),
    rooms: new Map(),
    tracks: new Map(),
    components: new Map(),
    lines: new Set()
  };
}

/** What a step's frame is drawn with: the view's props, the frame's settings and the contexts. */
export type StepDrawing = {
  copies: Record<number, number>;
  props: Record<string, unknown>;
  settings: FrameSettings;
  context: Map<string, unknown>;
};

/** A presentation's states, and what each step's frame is drawn with. */
export type Steps = {
  states: readonly unknown[];
  stepCount: number;
  /** The step a state is a phase of. */
  stepOf: (phase: number) => number;
  /** Each state, by the first state drawn exactly like it. */
  drawnLike: number[];
  /** The first state of each drawn alike, which laying out draws. */
  distinct: number[];
  drawingOf: (
    step: number,
    phase: Phase,
    layouts: Layouts,
    extra?: Record<string, unknown>,
    substituted?: StepState
  ) => StepDrawing;
};

export function stepsOf(
  states: readonly unknown[],
  atoms: Atoms,
  listing: StepListing,
  lengths: Readonly<Record<string, number>> = {}
): Steps {
  // Each step is two states, the one before its code runs and the one after (see phasesOf in
  // compile.server.ts): step k is states 2k and 2k + 1. The page rests on a step's after.
  const stepCount = states.length / 2;
  const stepOf = (phase: number) => Math.floor(phase / 2);

  // Each state, by the first state drawn exactly like it: the same values and the same listing lines
  // lit. Laying out draws only the first of each, as the others would come out the same.
  const drawnLike: number[] = [];
  const firstDrawn = new Map<string, number>();
  states.forEach((state, phase) => {
    const lit = listing?.lit[stepOf(phase)] ?? [];
    const key = JSON.stringify([state, lit, listing?.places?.touched[stepOf(phase)]]);
    if (!firstDrawn.has(key)) firstDrawn.set(key, phase);
    drawnLike.push(firstDrawn.get(key) as number);
  });
  const distinct = [...firstDrawn.values()];

  /** A type's unit, or that of the nearest type it refines. */
  function unitOf(typeName: string): string | undefined {
    for (let name: string | undefined = typeName; name && atoms[name]; name = atoms[name].parent)
      if (atoms[name].unit) return atoms[name].unit;
    return undefined;
  }

  /**
   * What a step's frame is drawn with: the view's props and the contexts it reads. `extra` props are
   * passed to the view, such as __probe, which has it render a component for given values;
   * `substituted` draws the step with other values in place of the trace's.
   */
  function drawingOf(
    step: number,
    phase: Phase,
    layouts: Layouts,
    extra: Record<string, unknown> = {},
    substituted?: StepState
  ): StepDrawing {
    const {
      __types: types = {},
      __targets: targets = {},
      __identities: identities = {},
      __copies: copies = {},
      __refs: refs = {},
      __absent: absent = [],
      __design: design,
      __frame: frame,
      __leftOut: leftOut = [],
      __hiddenSites: hiddenSites = [],
      ...state
    } = substituted ?? (states[step] as StepState);
    // Arrays and objects in the props, by path and the other way round, so a node can find the types
    // of its items and the length of the collection it is in.
    const paths = new WeakMap<object, string>();
    const containers = new Map<string, unknown>();
    const record = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return;
      paths.set(value, path);
      containers.set(path, value);
      if (Array.isArray(value)) value.forEach((item, index) => record(item, `${path}[${index}]`));
      else for (const [key, item] of Object.entries(value)) record(item, `${path}.${key}`);
    };
    for (const [name, value] of Object.entries(state)) record(value, name);

    const memory: LayoutMemory = {
      ...layouts,
      step,
      measuring: phase === 'measuring',
      probing: extra.__probe !== undefined
    };
    return {
      copies,
      props: { ...state, ...extra },
      settings: frame,
      context: new Map<string, unknown>([
        ['sverlin:design', design],
        ['sverlin:left-out', new Set(leftOut)],
        ['sverlin:hidden-sites', new Set(hiddenSites)],
        ['sverlin:layout-memory', memory],
        [
          'sverlin:listing',
          listing
            ? {
                text: listing.text,
                regions: listing.regions,
                lit: listing.lit[stepOf(step)] ?? [],
                ...(listing.syntax ? { syntax: listing.syntax } : {}),
                ...(listing.places
                  ? {
                      places: {
                        look: listing.places.look,
                        tokens: listing.places.tokens,
                        paints: listing.places.paints,
                        ...(listing.places.lines ? { lines: listing.places.lines } : {}),
                        ...(listing.places.aliases ? { aliases: listing.places.aliases } : {})
                      },
                      touched: listing.places.touched[stepOf(step)] ?? []
                    }
                  : {})
              }
            : undefined
        ],
        [
          'sverlin:types',
          {
            itemType: (container: unknown, index: number) => {
              const path =
                container !== null && typeof container === 'object'
                  ? paths.get(container)
                  : undefined;
              return path === undefined ? undefined : types[`${path}[${index}]`];
            },
            pathOf: (container: unknown) =>
              container !== null && typeof container === 'object'
                ? paths.get(container)
                : undefined,
            targetOf: (path: string) => targets[path],
            identityOf: (path: string) => identities[path],
            absent: (name: string) => absent.includes(name),
            refOf: (path: string) => refs[path],
            elementWith: (identity: number) =>
              Object.keys(identities).find(
                (path) => identities[path] === identity && /\[\d+\]$/u.test(path)
              ),
            variablesOf: (typeName: string) =>
              Object.keys(state).filter((name) => types[name] === typeName),
            typeAt: (path: string) => types[path],
            lengthOf: (path: string) => {
              const collection = containers.get(path);
              return Array.isArray(collection) ? collection.length : undefined;
            },
            maxLengthOf: (path: string) => {
              const type = types[path];
              return type === undefined ? undefined : lengths[type];
            },
            parent: (typeName: string) => atoms[typeName]?.parent,
            unit: unitOf,
            places: (typeName: string) => atoms[typeName]?.places
          }
        ]
      ])
    };
  }

  return { states, stepCount, stepOf, drawnLike, distinct, drawingOf };
}

/** A step's state with the value at a path, such as i or edge.from, replaced. */
export function withValue(state: StepState, path: string, value: unknown): StepState {
  // States are plain data from the trace, so a JSON copy is a whole one, where structuredClone is
  // not there, as on the server.
  const copy = JSON.parse(JSON.stringify(state)) as StepState;
  const keys = path.split('.');
  let target: Record<string, unknown> = copy;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1) as string] = value;
  return copy;
}
