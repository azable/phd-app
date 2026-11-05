// Fixed browser entry for every presentation: mount the authored component inside the page frame,
// with the state recorded for a step. The sandbox document injects the
// first step; later steps arrive as messages from the app and are shown without reloading the page.
// Nodes find the atomic types of their values, and each type's parent and unit, through the
// 'sverlin:types' context. Every step's layout comes from the server (see layout.ts), and the page
// draws with it as given.

import { mount, unmount, type Component } from 'svelte';
import {
  applyGeometry,
  checkLayout,
  describeFrame,
  describeStep,
  animateStep,
  emptyLayouts,
  finishMotion,
  geometryFor,
  leaveLayer,
  stepsOf,
  Frame,
  pageCss,
  unpackStates,
  type Geometry,
  type LayoutCheck,
  type Phase,
  type Reservation,
  type SceneFrame,
  type SceneStep
} from 'sverlin';
import Main from 'virtual:component';
import atoms from 'virtual:atoms';
import { lengths, listing } from 'virtual:components';
import packed from 'virtual:trace';

const steps = stepsOf(unpackStates(packed), atoms, listing, lengths);
const { stepCount } = steps;

// The page theme every node draws on: colour tokens, the canvas, and spacing for the page itself.
const theme = document.createElement('style');
theme.textContent = pageCss;
document.head.append(theme);

const playback = window as typeof window & {
  __sverlinStep?: number;
  __sverlinSelection?: unknown;
  /** How recording sized the nodes, for whoever looks on, as the timing harness does. */
  __sverlinReservation?: Reservation;
  /**
   * Every step's layout as the server worked it out, at each device pixel ratio borders snap
   * differently at, which the bundle sets before this runs.
   */
  __sverlinGeometry?: Geometry[];
};
// Step k is states 2k and 2k + 1 (see library/steps.ts); the page rests on a step's after.
const clampStep = (step: number) => Math.min(Math.max(step, 0), stepCount - 1);
const afterOf = (step: number) => 2 * step + 1;

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
  layout?: 'server';
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
const layouts = emptyLayouts();

/** What a step's frame is drawn with, by the layouts every step shares (see library/steps.ts). */
const drawingOf = (step: number, phase: Phase) => steps.drawingOf(step, phase, layouts);

/** Mount a step's frame in a hidden layer; `settled` runs once its layout stops changing. */
function mountStep(step: number, settled: (shown: Shown) => void): Shown {
  const layer = document.createElement('div');
  layer.className = 'sv-layer pending';
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
 * Values move from where the step on screen showed them, in one motion (see library/motion.ts); a
 * step shown before a move ends finishes it.
 */
let pendingTiming: ReturnType<typeof timePass> | undefined;
let leaving: Shown | undefined;

const showStep = (step: number) => show(afterOf(step));

/**
 * Marks the page settled at a step: once it is shown, its motion and the leaving step's fade have
 * ended, the fonts have loaded and a frame has passed for layouts that lay out again after motion.
 * `data-sv-settled` on the page's root holds the step, cleared as another is asked for, so a test
 * waits for it rather than for a fixed time; looping animations never hold it back.
 */
let settling = 0;
function settleAt(step: number) {
  const token = ++settling;
  delete root.dataset.svSettled;
  const running = () =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState !== 'finished' &&
          animation.playState !== 'idle' &&
          animation.effect?.getTiming().iterations !== Infinity
      );
  const frame = () => new Promise((resume) => requestAnimationFrame(() => resume(undefined)));
  void (async () => {
    await document.fonts.ready;
    for (let rounds = 0; rounds < 20; rounds++) {
      await frame();
      await frame();
      const left = running();
      if (!left.length && !pending && !leaving) break;
      await Promise.race([
        Promise.allSettled(left.map((animation) => animation.finished)),
        new Promise((resume) => setTimeout(resume, 250))
      ]);
    }
    if (token === settling && !pending) root.dataset.svSettled = String(step);
  })();
}

function show(state: number) {
  if (pending) remove(pending);
  pendingTiming?.cancel();
  let mounted: Shown | undefined;
  const timed = (pendingTiming = timePass('showing', state, () => mounted));
  pending = mounted = mountStep(state, (shown) => {
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
        state === before.step + 2 ? shown.copies : {}
      );
      leaving = before;
      leaveLayer(before.layer, gone, () => {
        if (leaving !== before) return;
        remove(before);
        leaving = undefined;
      });
    }
    current = shown;
    // The first step shown means the page is ready, so the app can take its loader away.
    if (!ready) reportTiming({ phase: 'ready', ms: Math.round(performance.now() - pageStarted) });
    if (!ready && window.parent !== window)
      window.parent.postMessage({ type: 'sverlin:ready' }, '*');
    ready = true;
    pending = undefined;
    settleAt((state - 1) / 2);
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
 * The embedded fonts every text is drawn in, which the server measured it in, loaded before any
 * step is drawn, so text is never drawn in a font the page falls back to while they load; whether
 * every one loaded. The sandbox document declares them (see ../fonts).
 */
async function loadFonts(): Promise<boolean> {
  const faces = [...document.fonts];
  const loaded = await Promise.all(
    faces.map((face) =>
      face.load().then(
        () => true,
        () => false
      )
    )
  );
  return faces.length > 0 && loaded.every(Boolean);
}
/** The embedded fonts' version, as the sandbox document names it. */
const fonts = document.querySelector<HTMLMetaElement>('meta[name="sverlin-fonts"]')?.content;

/**
 * Report how wide this page sets a sample text in each embedded font, at the sizes text is drawn
 * at, so the app's load report can be compared with the server's measure of the same text. It
 * takes about a millisecond.
 */
function reportFontWidths(loaded: boolean) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context || window.parent === window) return;
  const sample = '0123456789 Hamburgefonstiv ∞→';
  const widths: Record<string, number> = {};
  for (const family of new Set([...document.fonts].map((face) => face.family.replace(/"/gu, ''))))
    for (const weight of [400, 700])
      for (const size of [16, 13.6]) {
        context.font = `${weight} ${size}px "${family}"`;
        widths[`${family} ${weight} ${size}`] = +context.measureText(sample).width.toFixed(4);
      }
  window.parent.postMessage(
    {
      type: 'sverlin:fonts',
      ...(fonts ? { version: fonts } : {}),
      loaded,
      sample,
      widths,
      devicePixelRatio: window.devicePixelRatio
    },
    '*'
  );
}

/**
 * Every step's layout, as the server worked it out and gave it with the bundle (see layout.ts),
 * drawn with as given: in the embedded fonts once they load, or, where they fail, in the fonts the
 * page falls back to, which its fonts report says. A bundle with no layout cannot be shown.
 */
async function layOut() {
  const started = performance.now();
  reportFontWidths(await loadFonts());
  const given = geometryFor(playback.__sverlinGeometry, window.devicePixelRatio);
  if (!given) throw new Error('This visualization came without its layout, so it cannot be shown.');
  applyGeometry(layouts, given);
  playback.__sverlinReservation = given.reservation;
  reportTiming({
    phase: 'recording',
    ms: Math.round(performance.now() - started),
    layout: 'server'
  });
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
const recording = layOut();

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
  // No longer settled at the step before: a test waits for this one.
  settling++;
  delete root.dataset.svSettled;
  if (recorded && afterOf(step) !== (pending ?? current)?.step) showStep(step);
  else if (recorded && !pending) settleAt(step);
});

// The page says it has loaded; it reports when its first step is shown, however long laying out
// every step takes, so the app keeps its loader up until then.
if (window.parent !== window) window.parent.postMessage({ type: 'sverlin:loaded' }, '*');
// A page without its layout says why instead of showing any step.
recording.then(
  () => {
    recorded = true;
    showStep(requested);
  },
  (cause: unknown) => {
    reportError(cause);
    const notice = document.createElement('p');
    notice.className = 'sv-error';
    notice.textContent = errorText(cause);
    root.append(notice);
  }
);
