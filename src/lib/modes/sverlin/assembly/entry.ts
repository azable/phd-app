// Fixed browser entry for every presentation: mount the authored component inside the page frame,
// with the state recorded for a step, plus the step and seed. The sandbox document injects the
// first step; later steps arrive as messages from the app and are shown without reloading the page.
// Nodes find the atomic types of their values, and each type's parent and unit, through the
// 'sverlin:types' context.

import { mount, unmount, type Component } from 'svelte';
import {
  describeFrame,
  describeStep,
  Frame,
  settleSpans,
  themeCss,
  widestInteger,
  type FrameSettings,
  type LayoutMemory,
  type NodeDefaults,
  type SceneFrame,
  type SceneStep
} from 'sverlin';
import Main from 'virtual:component';
import atoms from 'virtual:atoms';
import { components, placements } from 'virtual:components';
import states from 'virtual:trace';

// The page theme every node draws on: colour tokens, the canvas, and spacing for the page itself.
const theme = document.createElement('style');
theme.textContent = `${themeCss}
.sv-layer { position: fixed; inset: 0; }
.sv-layer.pending { visibility: hidden; }`;
document.head.append(theme);

type StepState = Record<string, unknown> & {
  __types?: Record<string, string>;
  __defaults: NodeDefaults;
  __frame: FrameSettings;
};

const playback = window as typeof window & {
  __sverlinStep?: number;
  __sverlinSeed?: number;
  __sverlinSelection?: unknown;
};
const clampStep = (step: number) => Math.min(Math.max(step, 0), states.length - 1);

// The drawn font applies page-wide, so every node inherits it unless it sets its own. Drawn
// defaults belong to the presentation, so every step shares them. It is set on the body, which the
// sandbox document gives a font of its own (see ../../sandbox.ts).
const fonts: Record<string, string> = {
  sans: 'system-ui, sans-serif',
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
};
const font = (states[0] as StepState).__defaults.font;
if (fonts[font]) document.body.style.fontFamily = fonts[font];

/** A type's unit, or that of the nearest type it refines. */
function unitOf(typeName: string): string | undefined {
  for (let name: string | undefined = typeName; name && atoms[name]; name = atoms[name].parent)
    if (atoms[name].unit) return atoms[name].unit;
  return undefined;
}

// The mounted app, unless the view failed to mount, in which case the layer holds a notice instead,
// with how many times its layout changed before settling, for timing reports.
type Shown = { step: number; layer: HTMLElement; app?: Record<string, unknown>; changes: number };

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
    __defaults: defaults,
    __frame: frame,
    ...state
  } = substituted ?? (states[step] as StepState);
  // Arrays and objects in the props, by path, so a node can find the types of its items.
  const paths = new WeakMap<object, string>();
  const record = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    paths.set(value, path);
    if (Array.isArray(value)) value.forEach((item, index) => record(item, `${path}[${index}]`));
    else for (const [key, item] of Object.entries(value)) record(item, `${path}.${key}`);
  };
  for (const [name, value] of Object.entries(state)) record(value, name);

  const layer = document.createElement('div');
  layer.className = 'sv-layer pending';
  root.append(layer);
  const shown: Shown = { step, layer, changes: 0 };
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
        ['sverlin:defaults', defaults],
        ['sverlin:layout-memory', memory],
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
 */
let pendingTiming: ReturnType<typeof timePass> | undefined;
function show(step: number) {
  if (pending) remove(pending);
  pendingTiming?.cancel();
  let mounted: Shown | undefined;
  const timed = (pendingTiming = timePass('showing', step, () => mounted));
  pending = mounted = mountStep(step, 'showing', (shown) => {
    if (pending !== shown) return;
    timed.done();
    shown.layer.classList.remove('pending');
    if (current) remove(current);
    current = shown;
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
  for (let step = 0; step < states.length; step++) {
    await whenShown();
    steps.push(
      await new Promise<SceneStep>((done) => {
        mountStep(step, 'showing', (shown) => {
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
  if (recorded && step !== (pending ?? current)?.step) show(step);
});

// The page says it will report when its first step is shown, however long laying out every step
// takes, so the app keeps its loader up until then, and that it can describe its steps as scenes.
if (window.parent !== window)
  window.parent.postMessage({ type: 'sverlin:loaded', reportsReady: true, describes: true }, '*');
void recording.then(() => {
  recorded = true;
  show(requested);
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
