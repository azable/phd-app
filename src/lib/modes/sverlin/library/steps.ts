/**
 * A presentation's recorded states as the view draws them: what each step's frame is drawn with,
 * its props and the contexts it reads, worked out from the states alone, so the page and the server
 * (see ../assembly/entry.ts and ../assembly/layout.ts) draw a step alike.
 */

import type { DesignValues } from './node/design';
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
export type Atoms = Record<string, { parent?: string; unit?: string }>;

/** The listing in the variant's language, and what each step lights, if the view places one. */
export type StepListing = {
  text: string;
  regions: { label: string; start: number; end: number }[];
  lit: [number, number][][];
} | null;

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

export function stepsOf(states: readonly unknown[], atoms: Atoms, listing: StepListing): Steps {
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
    const key = JSON.stringify([state, lit]);
    if (!firstDrawn.has(key)) firstDrawn.set(key, phase);
    drawnLike.push(firstDrawn.get(key) as number);
  });
  const distinct = [...firstDrawn.values()];

  // Every collection or record each variable holds at any step, by identity, so a pointer through a
  // variable, as c into row = paths[r], keeps room in every row it can point into.
  const held = new Map<string, Set<number>>();
  for (const { __identities: identities = {} } of states as StepState[])
    for (const [path, identity] of Object.entries(identities))
      if (!/[[.]/u.test(path)) held.set(path, (held.get(path) ?? new Set()).add(identity));

  // Every collection a position at a path points into at any step, the indices left out, as a
  // position stored in a record points into whichever collection it came from.
  const reached = new Map<string, Set<string>>();
  const anyIndex = (path: string) => path.replace(/\[\d+\]/gu, '[]');
  for (const step of states as StepState[])
    for (const [path, target] of Object.entries(step.__targets ?? {}))
      reached.set(anyIndex(path), (reached.get(anyIndex(path)) ?? new Set()).add(target));

  // How far before the start and past the end of each collection variable any step records a
  // position bound to it, by the position's path (its indices left out) and over all of them, so a
  // pointer keeps end slots only as far as the positions it draws go. A variable out of scope at a
  // step only stands in there, so it records nothing.
  const pastEnds = new Map<string, { before: number; after: number }>();
  const endsKey = (collection: string, path?: string) =>
    `${path === undefined ? '' : anyIndex(path)}>${collection}`;
  // The view keeps room at most this far past either end, as each place is an empty slot; a pointer
  // further out points nowhere, drawing nothing, as one outside its collection does.
  const maximumPastEnd = 4;
  for (const step of states as StepState[])
    for (const [path, target] of Object.entries(step.__targets ?? {})) {
      const standsIn = (at: string) => step.__absent?.includes(at.split(/[.[]/u)[0]) ?? false;
      if (standsIn(path) || standsIn(target)) continue;
      const position = valueAt(step, path);
      const collection = valueAt(step, target);
      if (typeof position !== 'number' || !Array.isArray(collection)) continue;
      for (const key of [endsKey(target, path), endsKey(target)]) {
        const ends = pastEnds.get(key) ?? { before: 0, after: 0 };
        pastEnds.set(key, {
          before: Math.min(maximumPastEnd, Math.max(ends.before, -position)),
          after: Math.min(maximumPastEnd, Math.max(ends.after, position - collection.length + 1))
        });
      }
    }

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
            ? { text: listing.text, regions: listing.regions, lit: listing.lit[stepOf(step)] ?? [] }
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
            heldBy: (name: string) => held.get(name),
            reachedFrom: (path: string) => reached.get(anyIndex(path)),
            pastEnds: (collection: string, path?: string) =>
              pastEnds.get(endsKey(collection, path)) ?? { before: 0, after: 0 },
            lengthOf: (path: string) => {
              const collection = containers.get(path);
              return Array.isArray(collection) ? collection.length : undefined;
            },
            parent: (typeName: string) => atoms[typeName]?.parent,
            unit: unitOf
          }
        ]
      ])
    };
  }

  return { states, stepCount, stepOf, drawnLike, distinct, drawingOf };
}

/** The value at a path of a step's state, as edges[0].to. */
function valueAt(state: Record<string, unknown>, path: string): unknown {
  const [name, ...keys] = path.split(/[.[\]]+/u).filter(Boolean);
  return keys.reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    state[name]
  );
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
