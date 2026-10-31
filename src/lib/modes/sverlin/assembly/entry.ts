// Fixed browser entry for every presentation: mount the authored component inside the page frame,
// with the state recorded for a step. The sandbox document injects the
// first step; later steps arrive as messages from the app and are shown without reloading the page.
// Nodes find the atomic types of their values, and each type's parent and unit, through the
// 'sverlin:types' context.

import { mount, unmount, type Component } from 'svelte';
import { render } from 'svelte/server';
import {
  ancestorsOf,
  canvasMeasure,
  treeOf,
  checkLayout,
  elementsUnder,
  parseSheet,
  probeComponent,
  readMarkup,
  reserveSizes,
  styler,
  withLines,
  describeFrame,
  describeStep,
  animateStep,
  finishMotion,
  leaveLayer,
  motionCss,
  Frame,
  linePairs,
  themeCss,
  widestInteger,
  unpackStates,
  type FrameSettings,
  type DesignValues,
  type LayoutCheck,
  type Drawing,
  type LayoutMemory,
  type ModelElement,
  type Reservation,
  type SceneFrame,
  type SceneStep
} from 'sverlin';
import Main from 'virtual:component';
import MainServer from 'virtual:component-server';
import { Frame as FrameServer } from 'virtual:library-server';
import atoms from 'virtual:atoms';
import { components, listing, placements } from 'virtual:components';
import packed from 'virtual:trace';

const states = unpackStates(packed);

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
  __sverlinSelection?: unknown;
  /** How recording sized the nodes, for whoever looks on, as the timing harness does. */
  __sverlinReservation?: Reservation;
};
// Each step is two states, the one before its code runs and the one after (see phasesOf in
// compile.server.ts): step k is states 2k and 2k + 1. The page rests on a step's after.
const stepCount = states.length / 2;
const clampStep = (step: number) => Math.min(Math.max(step, 0), stepCount - 1);
const afterOf = (step: number) => 2 * step + 1;
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

// Layouts for every step, made once before any step is shown (see LayoutMemory).
const scopes: LayoutMemory['scopes'] = new Map();
const fits: LayoutMemory['fits'] = new Map();
const reserved: LayoutMemory['reserved'] = new Map();
const componentSizes: LayoutMemory['components'] = new Map();
const lines: LayoutMemory['lines'] = new Set();

/**
 * Measuring draws each step's markup, recording makes the layouts from it on the layout model, and
 * showing mounts a step with them.
 */
type Phase = 'measuring' | 'recording' | 'showing';

/**
 * What a step's frame is drawn with: the view's props and the contexts it reads. `extra` props are
 * passed to the view, such as __probe, which has it render a component for given values;
 * `substituted` draws the step with other values in place of the trace's.
 */
function drawingOf(
  step: number,
  phase: Phase,
  extra: Record<string, unknown> = {},
  substituted?: StepState
) {
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
    step,
    measuring: phase === 'measuring',
    probing: extra.__probe !== undefined,
    scopes,
    fits,
    reserved,
    components: componentSizes,
    lines
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
            container !== null && typeof container === 'object' ? paths.get(container) : undefined,
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

/** Mount a step's frame in a hidden layer; `settled` runs once its layout stops changing. */
function mountStep(step: number, settled: (shown: Shown) => void): Shown {
  const layer = document.createElement('div');
  layer.className = 'sv-layer pending';
  // Which of its step's two states the layer shows, for whoever looks on, as the tests do.
  layer.dataset.svPhase = step % 2 ? 'after' : 'before';
  root.append(layer);
  const { copies, props, settings, context } = drawingOf(step, 'showing');
  const shown: Shown = { step, layer, changes: 0, copies };
  try {
    shown.app = mount(Frame, {
      target: layer,
      props: {
        view: Main as Component<Record<string, unknown>>,
        props,
        settings,
        onsettled: () => settled(shown),
        onchanged: () => shown.changes++
      },
      context
    });
  } catch (cause) {
    // A view that fails at a step shows why there, and the other steps still load.
    reportError(cause, step);
    const notice = document.createElement('p');
    notice.className = 'sv-error';
    notice.textContent = `Step ${step + 1} could not be drawn: ${errorText(cause)}`;
    layer.append(notice);
    queueMicrotask(() => settled(shown));
  }
  return shown;
}

/** The style sheets of the library's components, by id, as their markup brings them. */
const componentSheets = new Map<string, string>();
/** The rules the layout model reads, the theme's and the components', worked out again for new ones. */
let model: { rules: ReturnType<typeof parseSheet>; styler: ReturnType<typeof styler> } | undefined;
function modelRules() {
  if (!model) {
    const rules = parseSheet(theme.textContent ?? '');
    for (const sheet of componentSheets.values()) rules.push(...parseSheet(sheet, rules.length));
    model = { rules, styler: styler(rules, window.devicePixelRatio) };
  }
  return model;
}

/**
 * Draw a step's markup, as Svelte's string renderer writes it, without mounting it, for laying out
 * on the layout model (see library/model/reserve.ts). `extra` and `substituted` are as for
 * drawingOf; a view that fails at a step reports why, and one failing with substituted values,
 * which no run produces, is left out.
 */
function drawMarkup(
  step: number,
  extra?: Record<string, unknown>,
  substituted?: StepState
): ModelElement | undefined {
  try {
    const { props, settings, context } = drawingOf(step, 'measuring', extra, substituted);
    const { head, body } = render(FrameServer, {
      props: { view: MainServer, props, settings },
      context
    });
    for (const [, id, sheet] of head.matchAll(/<style id="([^"]*)">([\s\S]*?)<\/style>/gu))
      if (!componentSheets.has(id)) {
        componentSheets.set(id, sheet);
        model = undefined;
      }
    return readMarkup(body, { tag: 'div', attributes: { class: 'sv-layer pending' } });
  } catch (cause) {
    if (!substituted) reportError(cause, step);
    return undefined;
  }
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
  pending = mounted = mountStep(step, (shown) => {
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
    // The first step shown means the page is ready, so the app can take its loader away.
    if (!ready) reportTiming({ phase: 'ready', ms: Math.round(performance.now() - pageStarted) });
    if (!ready && window.parent !== window)
      window.parent.postMessage({ type: 'sverlin:ready' }, '*');
    ready = true;
    pending = undefined;
  });
}

/**
 * Settles once the page has first been laid out. A frame in its page's markup can run while its
 * page is still loading, when the window already has a size but nothing in it has a box yet: every
 * node measures empty, and a free layout solved for empty children squeezes them once they have
 * sizes, so their text wraps and they keep that shape. An observer reports only after layout.
 */
const laidOut = new Promise<void>((resume) => {
  const observer = new ResizeObserver(() => {
    observer.disconnect();
    resume();
  });
  observer.observe(document.documentElement);
});

/**
 * Wait until the page is shown and has a size. A hidden page, such as one in a covered window or a
 * background tab, has no animation frames and throttled timers, so each layout pass would crawl.
 * A sandboxed frame can also start before its size arrives, and the browser does not always fire
 * resize when that first size is applied, so the size is observed instead: an observer reports a
 * size as soon as it is no longer zero. How long it waited, and for what, is reported.
 */
async function whenShown() {
  await laidOut;
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
 * Work out every step's layout before any is shown, without mounting any (see LayoutMemory): draw
 * the markup of the first of each of the states drawn alike (see drawnLike), find the pairs of
 * links drawn as one line, size each typed component over the values of its parameters, then lay
 * every node out on the layout model, bottom up, each keeping the largest size it reaches and each
 * free layout solved once over every step (see library/model/reserve.ts). Laying out gives the page
 * back for a moment between these, so a long presentation never holds its page up for long.
 */
async function recordSteps() {
  const pause = () => new Promise<void>((resume) => setTimeout(resume));
  let started = performance.now();
  const timed = (phase: Phase) => {
    reportTiming({ phase, ms: Math.round(performance.now() - started) });
    started = performance.now();
  };
  const drawn = new Map<number, ModelElement>();
  for (const step of distinct) {
    const markup = drawMarkup(step);
    if (markup) drawn.set(step, markup);
  }
  // The links each step shows, by pair and way, for the pairs drawn as one line (see linePairs).
  const shownLinks: Set<string>[] = [];
  for (const [step, markup] of drawn)
    shownLinks[step] = new Set(
      [...elementsUnder(markup)]
        .filter(
          ({ attributes }) =>
            attributes['data-sv-pair'] !== undefined && attributes['data-shown'] !== 'false'
        )
        .map(({ attributes }) => `${attributes['data-sv-pair']}|${attributes['data-sv-way']}`)
    );
  states.forEach((_, step) => (shownLinks[step] = shownLinks[drawnLike[step]] ?? new Set()));
  for (const pair of linePairs(shownLinks)) lines.add(pair);
  const drawings: Drawing[] = [...drawn].map(([step, markup]) => ({
    step,
    markup: withLines(markup, lines)
  }));
  // Values the root reads for placement are drawn with every value of their types, in a step where
  // they are recorded, so it has room for values the trace never reaches.
  for (const { path, step, values } of placements)
    for (const value of values) {
      const markup = drawMarkup(step, undefined, withValue(states[step] as StepState, path, value));
      if (markup) drawings.push({ markup: withLines(markup, lines) });
    }
  timed('measuring');
  await pause();
  started = performance.now();
  const memory: LayoutMemory = {
    step: 0,
    scopes,
    fits,
    reserved,
    components: componentSizes,
    lines
  };
  const measure = canvasMeasure();
  const ancestors = [...ancestorsOf(root), { ...treeOf(root, false), children: [] }];
  const options = () => ({
    ...modelRules(),
    measure,
    devicePixelRatio: window.devicePixelRatio,
    ancestors,
    memory
  });
  // A typed component is drawn once with each value of its type it is sized by, and its root keeps
  // the largest box it reaches: every value has room, whether or not this trace ever shows it.
  // Components come after those they render, whose boxes they are drawn with.
  for (const { name, cases, range } of components) {
    const probe = (values: unknown[]) => {
      const markup = drawMarkup(0, { __probe: { component: name, cases: values } });
      if (!markup) return undefined;
      const { box, font } = probeComponent(withLines(markup, lines), name, options());
      if (box) componentSizes.set(name, box);
      return font;
    };
    const font = probe(cases);
    // Digits differ in width in most fonts, and the font is drawn per presentation, so a range too
    // large to draw whole is drawn again with the integer that prints widest in the value's font.
    if (range && font) {
      const widest = widestInteger(range.min, range.max, characterWidths(font));
      if (!cases.includes(widest)) probe([widest]);
    }
  }
  playback.__sverlinReservation = reserveSizes(drawings, options());
  states.forEach((_, step) => {
    const fit = fits.get(drawnLike[step]);
    if (fit !== undefined) fits.set(step, fit);
  });
  timed('recording');
}

/**
 * Describe every step as scene data (see library/scene.ts), each laid out as it is shown, in a
 * hidden layer of its own, so the step on screen stays as it is; and, asked to check, how far the
 * layout model is from the page's layout of each (see library/model/check.ts).
 */
async function describeSteps(
  check: boolean
): Promise<{ frame?: SceneFrame; steps: SceneStep[]; checks?: LayoutCheck[] }> {
  let frame: SceneFrame | undefined;
  const steps: SceneStep[] = [];
  const checks: LayoutCheck[] = [];
  for (let step = 0; step < stepCount; step++) {
    await whenShown();
    steps.push(
      await new Promise<SceneStep>((done) => {
        mountStep(afterOf(step), (shown) => {
          frame ??= describeFrame(shown.layer);
          const flow = shown.layer.querySelector<HTMLElement>('.sv-flow');
          if (check && flow) checks.push(checkLayout(flow));
          done(describeStep(shown.layer));
          remove(shown);
        });
      })
    );
  }
  return { frame, steps, ...(check ? { checks } : {}) };
}

let ready = false;
let requested = clampStep(playback.__sverlinStep ?? 0);
let recorded = false;
// Laying out that fails says why, and the steps are still shown, laid out as they come.
const recording = recordSteps().catch((cause: unknown) => reportError(cause));

// The app sends each new step, with the selection to show in it; the page and its layout engine
// stay loaded, and the canvas view carries over. It can also ask for every step as scene data.
addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const data = event.data as {
    type?: unknown;
    step?: unknown;
    selection?: unknown;
    request?: unknown;
    check?: unknown;
  };
  if (data?.type === 'sverlin:describe' && typeof data.request === 'string') {
    const request = data.request;
    void recording
      .then(() => describeSteps(data.check === true))
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
