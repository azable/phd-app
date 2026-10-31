// Fixed browser entry for every presentation: mount the authored component inside the page frame,
// with the state recorded for a step. The sandbox document injects the
// first step; later steps arrive as messages from the app and are shown without reloading the page.
// Nodes find the atomic types of their values, and each type's parent and unit, through the
// 'sverlin:types' context. Every step's layout is worked out before any is shown (see
// library/record.ts).

import { mount, unmount, type Component } from 'svelte';
import { render } from 'svelte/server';
import {
  ancestorsOf,
  canvasMeasure,
  checkLayout,
  describeFrame,
  describeStep,
  animateStep,
  emptyLayouts,
  finishMotion,
  leaveLayer,
  recordLayouts,
  stepsOf,
  treeOf,
  Frame,
  pageCss,
  unpackStates,
  type LayoutCheck,
  type Phase,
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

const steps = stepsOf(unpackStates(packed), atoms, listing);
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
 * Work out every step's layout before any is shown, without mounting any (see library/record.ts).
 * Laying out gives the page back for a moment between its parts, so a long presentation never
 * holds its page up for long.
 */
async function recordSteps() {
  let started = performance.now();
  playback.__sverlinReservation = await recordLayouts({
    steps,
    layouts,
    sizing: { components, placements },
    render: ({ props, settings, context }) =>
      render(FrameServer, { props: { view: MainServer, props, settings }, context }),
    measure: canvasMeasure(),
    sheet: theme.textContent ?? '',
    devicePixelRatio: window.devicePixelRatio,
    ancestors: [...ancestorsOf(root), { ...treeOf(root, false), children: [] }],
    report: reportError,
    pause: () => new Promise<void>((resume) => setTimeout(resume)),
    timed: (phase) => {
      reportTiming({ phase, ms: Math.round(performance.now() - started) });
      started = performance.now();
    }
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
