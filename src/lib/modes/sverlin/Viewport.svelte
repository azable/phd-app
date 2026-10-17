<script lang="ts">
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import * as v from 'valibot';

  import { sandboxDocument, type CanvasView } from '../sandbox';
  import type { SelectedElement } from '$lib/client/visualization/visual-selection.svelte';
  import type { BrowserBundlePresentation } from '$lib/shared/presentations';
  import {
    layoutPassSchema,
    type PresentationLoadTiming
  } from '$lib/shared/presentation-load-timing';
  import { selectedElementSchema } from '$lib/shared/projects/events/message-content';
  import { sceneMessageSchema, type SverlinScene } from './scene';
  import { sverlinTargets } from './targets';
  import type { RenderedFile, RenderTarget } from '../render-targets';

  let {
    presentation,
    step,
    label,
    selection = [],
    onSelectionChange = () => {},
    onViewChange = () => {},
    onRuntimeError = () => {},
    onLoadTiming = () => {}
  }: {
    presentation: BrowserBundlePresentation;
    step: number;
    label: string;
    /** Ids of the elements to show selected. */
    selection?: readonly string[];
    onSelectionChange?: (elements: SelectedElement[]) => void;
    /** The canvas zoom and pan the participant left the presentation at. */
    onViewChange?: (view: CanvasView) => void;
    /** The view's own code failed as it drew a step (or, without a step, at some other moment). */
    onRuntimeError?: (failure: { step?: number; message: string }) => void;
    /** How long the page took to show its first step, or that it had not after a while. */
    onLoadTiming?: (timing: PresentationLoadTiming) => void;
  } = $props();

  let iframe = $state<HTMLIFrameElement>();
  // The iframe fills its pane exactly, however short: the canvas inside fits itself to the iframe, so
  // an iframe taller than its pane would be clipped, cutting off the canvas.
  // The page loads once per presentation, with the step and selection current then;
  // later steps are sent to it as messages, so it never reloads while stepping.
  const document = $derived.by(() => {
    void presentation.presentationId;
    return sandboxDocument(
      '',
      presentation.javascript.text,
      untrack(() => step),
      presentation.seed,
      undefined,
      untrack(() => selection)
    );
  });
  // Whether the page has loaded and listens for steps; a new document starts unloaded.
  let loaded = $state(false);
  // Whether the page shows its first step: it lays every step out before showing any.
  let ready = $state(false);
  // Whether the page can describe its steps as scene data; pages built before it could never say so.
  let describes = $state(false);
  $effect(() => {
    void document;
    loaded = false;
    ready = false;
    describes = false;
  });

  // Requests for the page's scene, answered by the page with the request's id.
  const sceneRequests: Record<
    string,
    (answer: v.InferOutput<typeof sceneMessageSchema> | Error) => void
  > = {};
  // Describing lays every step out once more, about as long as the first load, which takes about a
  // third of a second for six steps; two minutes leaves room for the longest traces (200 steps).
  const describeTimeoutMs = 120_000;

  /** The files this presentation can be exported as. */
  export function renderTargets(): RenderTarget[] {
    return sverlinTargets.map(({ id, title, animated }) => ({ id, title, animated }));
  }

  /** Export this presentation as a target's file, from its every step as scene data. */
  export async function render(target: string): Promise<RenderedFile> {
    const chosen = sverlinTargets.find(({ id }) => id === target);
    if (!chosen) throw new Error(`There is no ${target} export.`);
    return chosen.render(await describeScene());
  }

  /** Every step of this presentation as scene data, laid out as it is shown. */
  function describeScene(): Promise<SverlinScene> {
    const page = iframe?.contentWindow;
    if (!page || !loaded) return Promise.reject(new Error('The visualization has not loaded yet.'));
    if (!describes)
      return Promise.reject(
        new Error('This visualization was built before scene export. Build it again to export it.')
      );
    const request = crypto.randomUUID();
    const { presentationId, seed, labels, parameters } = presentation;
    return new Promise<SverlinScene>((resolve, reject) => {
      const timeout = setTimeout(
        () => answer(new Error('The visualization took too long to describe its steps.')),
        describeTimeoutMs
      );
      function answer(reply: v.InferOutput<typeof sceneMessageSchema> | Error) {
        clearTimeout(timeout);
        delete sceneRequests[request];
        if (reply instanceof Error) reject(reply);
        else if ('failure' in reply) reject(new Error(reply.failure));
        else if (reply.steps.length !== labels.length)
          reject(new Error('The visualization described a different number of steps.'));
        else
          resolve({
            format: 'sverlin-scene-v1',
            presentationId,
            seed,
            ...(parameters ? { parameters } : {}),
            frame: reply.frame,
            steps: reply.steps.map((step, index) => ({ ...step, label: labels[index] }))
          });
      }
      sceneRequests[request] = answer;
      page.postMessage({ type: 'sverlin:describe', request }, '*');
    });
  }
  // A new document cannot answer the old one's requests.
  $effect(() => {
    void document;
    return () => {
      for (const answer of Object.values(sceneRequests))
        answer(new Error('The visualization reloaded before it described its steps.'));
    };
  });

  $effect(() => {
    const shown = step;
    if (!loaded) return;
    // The step's selection is sent with it, so the new step shows it from the start.
    iframe?.contentWindow?.postMessage(
      { type: 'sverlin:step', step: shown, selection: untrack(() => [...selection]) },
      '*'
    );
  });

  // The page runs authored code, so every selection it reports is checked.
  const selectionMessage = v.object({
    type: v.literal('sverlin:selection'),
    elements: v.pipe(v.array(selectedElementSchema), v.maxLength(50))
  });

  // The view's own code can fail as it draws a step; the page reports it, and it is shown here.
  const errorMessage = v.object({
    type: v.literal('sverlin:error'),
    message: v.pipe(v.string(), v.maxLength(500)),
    step: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)))
  });
  let failure = $state<v.InferOutput<typeof errorMessage>>();
  $effect(() => {
    void document;
    failure = undefined;
  });

  // Load timing, for auditing and debugging slow or stuck loads: when this presentation's page
  // started loading here, each layout pass the page reports, and the outcome, logged to the console
  // as [sverlin] and reported once ready, or as stalled when not ready after a while.
  // A plain object schema drops the message's type, keeping only the pass.
  const timingMessage = v.object(layoutPassSchema.entries);
  type Pass = v.InferOutput<typeof layoutPassSchema>;
  let passes: Pass[] = [];
  let loadStarted = 0;
  let loadedAt: number | undefined;
  let frameAtLoad: PresentationLoadTiming['frameAtLoad'];
  /** Where the frame is on screen, to tell a zero-sized or off-screen frame from a slow page. */
  function frameBox(): PresentationLoadTiming['frameAtLoad'] {
    const box = iframe?.getBoundingClientRect();
    if (!box) return undefined;
    const round = (value: number) => Math.max(-100_000, Math.min(100_000, Math.round(value)));
    return {
      width: round(box.width),
      height: round(box.height),
      top: round(box.top),
      left: round(box.left)
    };
  }
  const logName = () => `[sverlin] ${label} (${presentation.presentationId.slice(0, 8)})`;
  const sinceLoad = () => Math.round(performance.now() - loadStarted);
  function loadTiming(outcome: PresentationLoadTiming['outcome']): PresentationLoadTiming {
    const settled = passes.filter(({ waiting }) => !waiting);
    const total = (phase: Pass['phase']) =>
      settled.filter((pass) => pass.phase === phase).reduce((sum, { ms }) => sum + ms, 0);
    const last = passes.at(-1);
    const pageMs = settled.find(({ phase }) => phase === 'ready')?.ms;
    const shown = settled.find(({ phase }) => phase === 'shown');
    return {
      presentationId: presentation.presentationId,
      outcome,
      sinceLoadMs: sinceLoad(),
      ...(pageMs === undefined ? {} : { pageMs }),
      ...(loadedAt === undefined ? {} : { loadedMs: loadedAt }),
      measuringMs: total('measuring'),
      recordingMs: total('recording'),
      showingMs: total('showing'),
      passes: settled.filter(({ phase }) => phase !== 'ready' && phase !== 'shown').length,
      ...(shown?.waitedFor ? { shownWait: { ms: shown.ms, waitedFor: shown.waitedFor } } : {}),
      mostChanges: Math.max(0, ...passes.map(({ changes }) => changes ?? 0)),
      visibility: globalThis.document.visibilityState === 'visible' ? 'visible' : 'hidden',
      ...(frameAtLoad ? { frameAtLoad } : {}),
      ...(iframe ? { frameAtOutcome: frameBox() } : {}),
      ...(last ? { last } : {})
    };
  }
  // Ten seconds is far beyond a normal load, about a third of a second for a six-step linked list.
  const stalledAfterMs = 10_000;
  $effect(() => {
    void document;
    passes = [];
    loadStarted = performance.now();
    loadedAt = undefined;
    frameAtLoad = undefined;
    const watchdog = setTimeout(() => {
      if (untrack(() => ready)) return;
      const timing = loadTiming('stalled');
      console.warn(`${logName()} not ready after ${timing.sinceLoadMs} ms`, timing);
      onLoadTiming(timing);
    }, stalledAfterMs);
    return () => clearTimeout(watchdog);
  });

  $effect(() => {
    const receive = (event: MessageEvent) => {
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        reportsReady?: unknown;
        describes?: unknown;
        request?: unknown;
      } & Partial<Record<keyof CanvasView, unknown>>;
      if (data?.type === 'sverlin:scene') {
        const answer =
          typeof data.request === 'string' && Object.hasOwn(sceneRequests, data.request)
            ? sceneRequests[data.request]
            : undefined;
        if (!answer) return;
        const parsed = v.safeParse(sceneMessageSchema, data);
        answer(
          parsed.success
            ? parsed.output
            : new Error('The visualization described its steps in an unexpected form.')
        );
        return;
      }
      if (data?.type === 'sverlin:timing') {
        const parsed = v.safeParse(timingMessage, data);
        if (!parsed.success) return;
        const pass = parsed.output;
        passes.push(pass);
        if (pass.waiting)
          console.warn(
            pass.phase === 'shown'
              ? `${logName()} waiting for its ${pass.waitedFor} before laying out`
              : `${logName()} still ${pass.phase} step ${pass.step} after ${pass.ms} ms, ${pass.changes ?? 0} layout changes`
          );
        return;
      }
      if (data?.type === 'sverlin:loaded') {
        loaded = true;
        describes = data.describes === true;
        loadedAt = sinceLoad();
        frameAtLoad = frameBox();
        // Presentations built before pages reported readiness never say so; stop waiting for them.
        // Newer pages always report it, however long laying out their steps takes.
        if (data.reportsReady === true) return;
        const waiting = document;
        setTimeout(() => {
          if (document === waiting) ready = true;
        }, 4000);
        return;
      }
      if (data?.type === 'sverlin:ready') {
        ready = true;
        const timing = loadTiming('ready');
        console.info(`${logName()} ready ${timing.sinceLoadMs} ms after loading began`, timing);
        onLoadTiming(timing);
        return;
      }
      if (data?.type === 'sverlin:error') {
        const parsed = v.safeParse(errorMessage, data);
        if (parsed.success) {
          failure = parsed.output;
          ready = true;
          onRuntimeError({
            message: parsed.output.message,
            ...(parsed.output.step === undefined ? {} : { step: parsed.output.step })
          });
        }
        return;
      }
      if (data?.type === 'sverlin:selection') {
        const parsed = v.safeParse(selectionMessage, data);
        if (parsed.success) onSelectionChange(parsed.output.elements);
        return;
      }
      const numbers = [data?.zoom, data?.panX, data?.panY];
      if (data?.type !== 'sverlin:view' || !numbers.every(Number.isFinite)) return;
      onViewChange({ zoom: Number(data.zoom), panX: Number(data.panX), panY: Number(data.panY) });
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  });

  // Show a selection the app sets, such as from a reference in the timeline, without reloading.
  $effect(() => {
    const ids = [...selection];
    iframe?.contentWindow?.postMessage({ type: 'sverlin:select', ids }, '*');
  });
</script>

<div class="relative h-full w-full">
  <iframe
    bind:this={iframe}
    title={label}
    srcdoc={document}
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    class="block h-full w-full border-0 bg-white"
  ></iframe>
  {#if !ready}
    <div
      class="absolute inset-0 flex items-center justify-center gap-2 bg-white text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
      out:fade={{ duration: 150 }}
    >
      <Spinner />
      <span>Loading…</span>
    </div>
  {/if}
  {#if failure}
    <p
      role="alert"
      class="absolute inset-x-2 bottom-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {failure.step === undefined
        ? 'The view failed while drawing'
        : `The view failed while drawing step ${failure.step + 1}`}: {failure.message}
    </p>
  {/if}
</div>
