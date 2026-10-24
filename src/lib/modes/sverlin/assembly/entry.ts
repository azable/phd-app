// Fixed browser entry for every presentation: mount the authored component inside the page frame,
// with the state recorded for a step, plus the step and seed. The sandbox document injects the
// first step; later steps arrive as messages from the app and are shown without reloading the page.
// Nodes find the atomic types of their values, and each type's parent and unit, through the
// 'sverlin:types' context.

import { mount, unmount, type Component } from 'svelte';
import {
  describeFrame,
  describeStep,
  animateStep,
  finishMotion,
  leaveLayer,
  motionCss,
  Frame,
  settleSpans,
  stepLayouts,
  themeCss,
  widestInteger,
  type FrameSettings,
  type DesignValues,
  type LayoutMemory,
  type SceneFrame,
  type SceneStep
} from 'sverlin';
import Main from 'virtual:component';
import atoms from 'virtual:atoms';
import { components, listing, placements } from 'virtual:components';
import states from 'virtual:trace';

// The page theme every node draws on: colour tokens, the canvas, and spacing for the page itself.
const theme = document.createElement('style');
theme.textContent = `${themeCss}
.sv-layer { position: fixed; inset: 0; }
.sv-layer.pending { visibility: hidden; }
.sv-layer:not(.pending) [data-sv-hidden='true'] { visibility: hidden; }
.sv-layer:not(.pending):not(.sv-leaving) [data-sv-hidden='false'] { visibility: visible; }
${motionCss}`;
document.head.append(theme);

type StepState = Record<string, unknown> & {
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

const playback = window as typeof window & {
  __sverlinStep?: number;
  __sverlinSeed?: number;
  __sverlinSelection?: unknown;
};
// Each step is two states, the one before its code runs and the one after (see phasesOf in
// compile.server.ts): step k is states 2k and 2k + 1. The page rests on a step's after.
const stepCount = states.length / 2;
const clampStep = (step: number) => Math.min(Math.max(step, 0), stepCount - 1);
const afterOf = (step: number) => 2 * step + 1;
const stepOf = (phase: number) => Math.floor(phase / 2);

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

/** The value at a path of a step's state, as edges[0].to. */
function valueAt(state: Record<string, unknown>, path: string): unknown {
  const [name, ...keys] = path.split(/[.[\]]+/u).filter(Boolean);
  return keys.reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    state[name]
  );
}

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

// The mounted app, unless the view failed to mount, in which case the layer holds a notice instead,
// with how many times its layout changed before settling, for timing reports.
/** A mounted step: its layer, and the values in it copied from another, by identity (see motion.ts). */
type Shown = {
  step: number;
  layer: HTMLElement;
  app?: Record<string, unknown>;
  changes: number;
  copies: Record<number, number>;
};

/**
 * Report how long laying out takes, so the app can log it: each pass's phase, step, duration, and
 * layout changes, a pass still waiting to settle, and the time until the first step is shown.
 */
type Timing = {
  phase: Phase | 'ready' | 'shown';
  step?: number;
  ms: number;
  changes?: number;
  waiting?: boolean;
  waitedFor?: 'size' | 'visibility';
};
const pageStarted = performance.now();
function reportTiming(timing: Timing) {
  if (window.parent !== window)
    window.parent.postMessage({ type: 'sverlin:timing', ...timing }, '*');
}
/**
 * Time one pass: `done` reports it once settled, and until then it is reported every two seconds
 * as waiting; `cancel` stops that for a pass replaced before it settled.
 */
function timePass(phase: Phase, step: number, shown: () => Shown | undefined) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const waiting = setInterval(
    () => reportTiming({ phase, step, ms: elapsed(), changes: shown()?.changes, waiting: true }),
    2000
  );
  return {
    done() {
      clearInterval(waiting);
      reportTiming({ phase, step, ms: elapsed(), changes: shown()?.changes });
    },
    cancel: () => clearInterval(waiting)
  };
}
const root = document.getElementById('app') ?? document.body;
let current: Shown | undefined;
let pending: Shown | undefined;

// Layouts for every step, made once in step order before any step is shown (see LayoutMemory).
const scopes: LayoutMemory['scopes'] = new Map();
const fits: LayoutMemory['fits'] = new Map();
const reserved: LayoutMemory['reserved'] = new Map();
const componentSizes: LayoutMemory['components'] = new Map();

/** Measuring finds each node's natural sizes, recording makes the layouts, showing replays them. */
type Phase = 'measuring' | 'recording' | 'showing';

/**
 * Mount a step's frame in a hidden layer; `settled` runs once its layout stops changing. `extra`
 * props are passed to the view, such as __probe, which has it render a component for given values;
 * `substituted` measures the step with other values in place of the trace's.
 */
function mountStep(
  step: number,
  phase: Phase,
  settled: (shown: Shown) => void,
  extra: Record<string, unknown> = {},
  substituted?: StepState
): Shown {
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

  const layer = document.createElement('div');
  layer.className = 'sv-layer pending';
  // Which of its step's two states the layer shows, for whoever looks on, as the tests do.
  layer.dataset.svPhase = step % 2 ? 'after' : 'before';
  root.append(layer);
  const shown: Shown = { step, layer, changes: 0, copies };
  const memory: LayoutMemory = {
    step,
    recording: phase === 'recording',
    measuring: phase === 'measuring',
    probing: extra.__probe !== undefined,
    scopes,
    fits,
    reserved,
    components: componentSizes
  };
  try {
    shown.app = mount(Frame, {
      target: layer,
      props: {
        view: Main as Component<Record<string, unknown>>,
        props: { ...state, step, seed: playback.__sverlinSeed ?? 1, ...extra },
        settings: frame,
        onsettled: () => settled(shown),
        onchanged: () => shown.changes++
      },
      context: new Map<string, unknown>([
        ['sverlin:design', design],
        ['sverlin:left-out', new Set(leftOut)],
        ['sverlin:hidden-sites', new Set(hiddenSites)],
        ['sverlin:layout-memory', memory],
        [
          'sverlin:listing',
          listing ? { text: listing.text, ...listing.lit[stepOf(step)] } : undefined
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
    });
  } catch (cause) {
    // A view that fails at a step shows why there, and the other steps still load. A substituted
    // state can combine values no run produces, so one that fails is no visual state to size for,
    // and is left out.
    if (!substituted) {
      reportError(cause, step);
      const notice = document.createElement('p');
      notice.className = 'sv-error';
      notice.textContent = `Step ${step + 1} could not be drawn: ${errorText(cause)}`;
      layer.append(notice);
    }
    queueMicrotask(() => settled(shown));
  }
  return shown;
}

function errorText(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
}

/** Tell the app the view failed, once per step and message, so it can say so. */
const reported = new Set<string>();
function reportError(cause: unknown, step?: number) {
  const message = errorText(cause);
  const key = `${step ?? ''} ${message}`;
  if (reported.has(key) || window.parent === window) return;
  reported.add(key);
  window.parent.postMessage(
    { type: 'sverlin:error', message, ...(step === undefined ? {} : { step }) },
    '*'
  );
}
addEventListener('error', (event) => {
  // Layout settling over more than one frame makes the browser warn about resize observers; it
  // is not a failure of the view.
  if (/^ResizeObserver loop/u.test(event.message)) return;
  reportError(event.error ?? event.message);
});
addEventListener('unhandledrejection', (event) => reportError(event.reason));

function remove(shown: Shown) {
  if (shown.app) unmount(shown.app);
  shown.layer.remove();
}

/**
 * Show a step from the records: mount it in a hidden layer, and once its layout settles, reveal it
 * and remove the step it replaces, so neither a blank page nor an unfinished layout is ever visible.
 * Values move from where the step before showed them (see library/motion.ts); a step shown before
 * a move ends finishes it.
 */
let pendingTiming: ReturnType<typeof timePass> | undefined;
let leaving: Shown | undefined;
// A step played forward shows its before, then its after once the moves into the before end; a
// newer request replaces it.
let following: object | undefined;

/**
 * Show a step: forward by one, its before and then its after, once whatever the before set moving
 * has finished, or at once where nothing moved; otherwise its after at once.
 */
function showStep(step: number) {
  following = undefined;
  const at = (pending ?? current)?.step;
  if (at !== undefined && at === afterOf(step - 1)) {
    const token = (following = {});
    show(afterOf(step) - 1, () => {
      void Promise.all(document.getAnimations().map((animation) => animation.finished)).then(
        () => {
          if (following === token) show(afterOf(step));
        },
        () => {
          if (following === token) show(afterOf(step));
        }
      );
    });
  } else show(afterOf(step));
}

function show(step: number, shownBefore?: () => void) {
  if (pending) remove(pending);
  pendingTiming?.cancel();
  let mounted: Shown | undefined;
  const timed = (pendingTiming = timePass('showing', step, () => mounted));
  pending = mounted = mountStep(step, 'showing', (shown) => {
    if (pending !== shown) return;
    timed.done();
    if (leaving) remove(leaving);
    leaving = undefined;
    if (current) finishMotion(current.layer);
    shown.layer.classList.remove('pending');
    if (current) {
      const before = current;
      // Only the step right after it copies values from it.
      const { gone } = animateStep(
        before.layer,
        shown.layer,
        step === before.step + 1 ? shown.copies : {}
      );
      leaving = before;
      leaveLayer(before.layer, gone, () => {
        if (leaving !== before) return;
        remove(before);
        leaving = undefined;
      });
    }
    current = shown;
    if (shownBefore) {
      shownBefore();
      pending = undefined;
      return;
    }
    // What the step drew implicitly, so the app can show it beside the tags that drew it.
    if (window.parent !== window)
      window.parent.postMessage(
        {
          type: 'sverlin:drawn',
          step: stepOf(step),
          layouts: stepLayouts(shown.layer)
        },
        '*'
      );
    // The first step shown means the page is ready, so the app can take its loader away.
    if (!ready) reportTiming({ phase: 'ready', ms: Math.round(performance.now() - pageStarted) });
    if (!ready && window.parent !== window)
      window.parent.postMessage({ type: 'sverlin:ready' }, '*');
    ready = true;
    pending = undefined;
  });
}

/**
 * Wait until the page is shown and has a size. A hidden page, such as one in a covered window or a
 * background tab, has no animation frames and throttled timers, so each layout pass would crawl.
 * A sandboxed frame can also start before its size arrives, and the browser does not always fire
 * resize when that first size is applied, so the size is observed instead: an observer reports a
 * size as soon as it is no longer zero. How long it waited, and for what, is reported.
 */
async function whenShown() {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let waitedFor: 'size' | 'visibility' | undefined;
  while (document.visibilityState !== 'visible' || !document.documentElement.clientWidth) {
    // Reported once as it starts, so a page that never shows says what it waits for.
    if (!waitedFor) {
      waitedFor = document.visibilityState !== 'visible' ? 'visibility' : 'size';
      reportTiming({ phase: 'shown', ms: 0, waitedFor, waiting: true });
    }
    await new Promise<void>((resume) => {
      const observer = new ResizeObserver(() => done());
      function done() {
        observer.disconnect();
        document.removeEventListener('visibilitychange', done);
        resume();
      }
      observer.observe(document.documentElement);
      document.addEventListener('visibilitychange', done);
    });
  }
  if (waitedFor) reportTiming({ phase: 'shown', ms: elapsed(), waitedFor });
}

/**
 * Measure every node at every step, keeping the largest size each reaches, then record what every
 * arrangement contains at every step and solve each once over all of them. The items of a
 * collection all keep the largest size any of them reaches: an item's own largest size depends on
 * the steps it took part in (the last cell of a search never holds the pointer), and items of
 * different sizes would not line up in a centred row.
 */
async function recordSteps() {
  // The ids of each collection's items, by the collection's id, gathered over every step.
  const collections = new Map<string, Set<string>>();
  const pass = async (
    step: number,
    phase: Phase,
    finish: (shown: Shown) => void,
    extra?: Record<string, unknown>,
    substituted?: StepState
  ) => {
    await whenShown();
    let mounted: Shown | undefined;
    const timed = timePass(phase, step, () => mounted);
    await new Promise<void>((done) => {
      mounted = mountStep(
        step,
        phase,
        (shown) => {
          timed.done();
          finish(shown);
          remove(shown);
          done();
        },
        extra,
        substituted
      );
    });
  };
  const measure = ({ layer }: Shown) => {
    for (const node of layer.querySelectorAll<HTMLElement>('[data-sv-node]')) {
      const id = node.dataset.svNode as string;
      const largest = reserved.get(id);
      // Layout sizes, unaffected by the frame's scale or the root's fit.
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      reserved.set(id, {
        width: Math.max(largest?.width ?? 0, width),
        height: Math.max(largest?.height ?? 0, height)
      });
    }
    for (const box of layer.querySelectorAll<HTMLElement>('[data-sv-collection]')) {
      const collection = box.dataset.svCollection;
      if (!collection) continue;
      const items = collections.get(collection) ?? new Set<string>();
      for (const child of box.children)
        if (child instanceof HTMLElement && child.dataset.svNode) items.add(child.dataset.svNode);
      collections.set(collection, items);
    }
  };
  for (let step = 0; step < states.length; step++) await pass(step, 'measuring', measure);
  // Values the root reads for placement are measured with every value of their types, in a step
  // where they are recorded, so it has room for values the trace never reaches.
  for (const { path, step, values } of placements)
    for (const value of values)
      await pass(
        step,
        'measuring',
        measure,
        undefined,
        withValue(states[step] as StepState, path, value)
      );
  for (const items of collections.values()) {
    const sizes = [...items].flatMap((id) => reserved.get(id) ?? []);
    const largest = {
      width: Math.max(0, ...sizes.map((size) => size.width)),
      height: Math.max(0, ...sizes.map((size) => size.height))
    };
    for (const id of items) reserved.set(id, largest);
  }
  // A typed component is drawn once with each value of its type it is sized by, and its root keeps
  // the largest box it reaches: every value has room, whether or not this trace ever shows it.
  // Components come after those they render, whose boxes they are drawn with.
  // offsetWidth and offsetHeight round to whole pixels, so a pixel more keeps the box from coming
  // out a fraction smaller than what it holds.
  for (const { name, cases, range } of components) {
    let font: string | undefined;
    const probe = (values: unknown[]) =>
      pass(
        0,
        'measuring',
        ({ layer }) => {
          const nodes = layer.querySelectorAll<HTMLElement>(
            `[data-sv-component="${CSS.escape(name)}"]`
          );
          let { width, height } = componentSizes.get(name) ?? { width: 0, height: 0 };
          for (const node of nodes) {
            width = Math.max(width, node.offsetWidth + 1);
            height = Math.max(height, node.offsetHeight + 1);
          }
          if (width || height) componentSizes.set(name, { width, height });
          const value = layer.querySelector<HTMLElement>(
            `[data-sv-component="${CSS.escape(name)}"] .value`
          );
          if (value) font ??= fontOf(value);
        },
        { __probe: { component: name, cases: values } }
      );
    await probe(cases);
    // Digits differ in width in most fonts, and the font is drawn per presentation, so a range too
    // large to draw whole is drawn again with the integer that prints widest in the value's font.
    if (range && font) {
      const widest = widestInteger(range.min, range.max, characterWidths(font));
      if (!cases.includes(widest)) await probe([widest]);
    }
  }
  // Record what every arrangement contains at every step, then solve each over all of them; a
  // nested arrangement's solution changes its size and so what its parent contains, so recording
  // repeats until no solution changes.
  for (let round = 0; round < 3; round++) {
    for (let step = 0; step < states.length; step++) await pass(step, 'recording', () => {});
    if (!settleSpans(scopes)) break;
  }
}

/**
 * Describe every step as scene data (see library/scene.ts), each laid out as it is shown, in a
 * hidden layer of its own, so the step on screen stays as it is.
 */
async function describeSteps(): Promise<{ frame?: SceneFrame; steps: SceneStep[] }> {
  let frame: SceneFrame | undefined;
  const steps: SceneStep[] = [];
  for (let step = 0; step < stepCount; step++) {
    await whenShown();
    steps.push(
      await new Promise<SceneStep>((done) => {
        mountStep(afterOf(step), 'showing', (shown) => {
          frame ??= describeFrame(shown.layer);
          done(describeStep(shown.layer));
          remove(shown);
        });
      })
    );
  }
  return { frame, steps };
}

let ready = false;
let requested = clampStep(playback.__sverlinStep ?? 0);
let recorded = false;
const recording = recordSteps();

// The app sends each new step, with the selection to show in it; the page and its layout engine
// stay loaded, and the canvas view carries over. It can also ask for every step as scene data.
addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const data = event.data as {
    type?: unknown;
    step?: unknown;
    selection?: unknown;
    request?: unknown;
  };
  if (data?.type === 'sverlin:describe' && typeof data.request === 'string') {
    const request = data.request;
    void recording
      .then(describeSteps)
      .then((scene) => window.parent.postMessage({ type: 'sverlin:scene', request, ...scene }, '*'))
      .catch((cause: unknown) =>
        window.parent.postMessage(
          { type: 'sverlin:scene', request, failure: errorText(cause) },
          '*'
        )
      );
    return;
  }
  if (data?.type !== 'sverlin:step' || typeof data.step !== 'number') return;
  const step = clampStep(data.step);
  playback.__sverlinSelection = Array.isArray(data.selection) ? data.selection : [];
  requested = step;
  if (recorded && afterOf(step) !== (pending ?? current)?.step) showStep(step);
});

// The page says it will report when its first step is shown, however long laying out every step
// takes, so the app keeps its loader up until then, and that it can describe its steps as scenes.
if (window.parent !== window)
  window.parent.postMessage({ type: 'sverlin:loaded', reportsReady: true, describes: true }, '*');
void recording.then(() => {
  recorded = true;
  showStep(requested);
});

/** A step's state with the value at a path, such as i or edge.from, replaced. */
function withValue(state: StepState, path: string, value: unknown): StepState {
  const copy = structuredClone(state);
  const keys = path.split('.');
  let target: Record<string, unknown> = copy;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1) as string] = value;
  return copy;
}

/** The font an element's text is drawn in, as a canvas takes it. */
function fontOf(element: HTMLElement): string {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/** Each character's width in a font. */
function characterWidths(font: string): (character: string) => number {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return () => 1;
  context.font = font;
  const widths = new Map<string, number>();
  return (character) => {
    if (!widths.has(character)) widths.set(character, context.measureText(character).width);
    return widths.get(character) as number;
  };
}
