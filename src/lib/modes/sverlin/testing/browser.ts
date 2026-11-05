/**
 * What the browser tests share, following Playwright's best practices
 * (https://playwright.dev/docs/best-practices): one browser for the run (testing/browser-setup.ts),
 * a fresh context for each test, so no test sees another's state, and waits on what the page says
 * rather than on time. A presentation marks its root `data-sv-settled` with the step once that step
 * is shown and its motion has ended (assembly/entry.ts); `showStep` waits for it.
 */

import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { inject, onTestFinished } from 'vitest';

import { sandboxDocument } from '../../sandbox';
import { embeddedFontsHead } from '../fonts';
import type { SceneFrame, SceneStep } from '../library';

/** Whether the browser tests run: `pnpm run test:browser` sets SVERLIN_RUN_BROWSER_TESTS=1. */
export const browserTestsOn = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

/** The longest a page may take to settle at a step, generous for a loaded machine. */
export const settleTimeout = 20_000;

let connected: Promise<Browser> | undefined;
function browser(): Promise<Browser> {
  return (connected ??= chromium.connect(inject('browserEndpoint')));
}

export type PageOptions = {
  viewport?: { width: number; height: number };
  /** Device pixels to a CSS pixel, as a high-density screen draws. */
  deviceScaleFactor?: number;
  /**
   * Motion off, as `prefers-reduced-motion: reduce`: each step is drawn at once at its end state.
   * Tests about where things end up use it; tests about motion keep it on.
   */
  still?: boolean;
};

/**
 * A page in a context of its own for the running test, closed when the test ends. In CI, its trace
 * is kept under test-results/ when the test fails, for the retry CI gives it to be read against.
 */
export async function openPage({
  viewport = { width: 1200, height: 700 },
  deviceScaleFactor,
  still = false
}: PageOptions = {}): Promise<Page> {
  const context = await (
    await browser()
  ).newContext({
    viewport,
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    reducedMotion: still ? 'reduce' : 'no-preference'
  });
  const traced = Boolean(process.env.CI);
  if (traced) await context.tracing.start({ screenshots: true, snapshots: true });
  onTestFinished(async ({ task }) => {
    if (traced) {
      const failed = task.result?.state === 'fail';
      const name = task.name.replace(/[^\w-]+/gu, '-').slice(0, 80);
      await context.tracing.stop(failed ? { path: `test-results/traces/${name}.zip` } : {});
    }
    await context.close();
  });
  return context.newPage();
}

/** A built presentation: its page's code and the scenes the server drew of every step. */
export type Built = { javascript: string; layout: { scenes?: Served } };

/**
 * Opens a built presentation at a step, in the embedded fonts, the page sent its scenes as it asks
 * as the app sends them, and waits until it has settled there.
 */
export async function openPresentation(
  built: Built,
  options: PageOptions & { step?: number; errors?: string[] } = {}
): Promise<Page> {
  const page = await openPage(options);
  if (options.errors) page.on('pageerror', (error) => options.errors!.push(error.message));
  const head = embeddedFontsHead + servingScript(scenesOf(built));
  await page.setContent(
    sandboxDocument('', built.javascript, options.step ?? 0, 1, undefined, undefined, head)
  );
  await settled(page, options.step ?? 0);
  return page;
}

function scenesOf(built: Built): Served {
  if (!built.layout.scenes) throw new Error('The server drew no scenes of this presentation.');
  return built.layout.scenes;
}

type Served = { frame: SceneFrame; steps: SceneStep[] };

/**
 * A script answering a presentation's requests for scenes as Viewport.svelte does, from the scenes
 * given: the page's own, which is its own parent, or, hosted, its frame's, whose every message it
 * keeps in `__messages`.
 */
function servingScript(served: Served, hosted = false): string {
  const scenes = JSON.stringify(served).replace(/</gu, '\\u003c');
  const presentation = hosted ? "document.querySelector('iframe')?.contentWindow" : 'window';
  return `<script>(() => {
    const served = ${scenes};
    window.__messages = [];
    addEventListener('message', ({ data, source }) => {
      const presentation = ${presentation};
      if (!presentation || source !== presentation) return;
      if (${hosted}) window.__messages.push(data);
      if (data?.type !== 'sverlin:scenes-wanted') return;
      const steps = data.steps.map((step) => [step, served.steps[step]]);
      presentation.postMessage({ type: 'sverlin:scenes', frame: served.frame, steps }, '*');
    });
  })();</script>`;
}

/**
 * A built presentation in a sandboxed frame filling a page, as the app hosts it, settled at its
 * first step: the page keeps every message the frame sends (`messages`), answers its requests for
 * scenes from those given, as Viewport.svelte does, and passes messages on to it (`send`).
 */
export async function openHosted(
  built: Built,
  options: PageOptions = {}
): Promise<{
  page: Page;
  frame: Frame;
  send(message: object): Promise<void>;
  messages(type: string): Promise<Record<string, unknown>[]>;
}> {
  const page = await openPage(options);
  const { width, height } = options.viewport ?? { width: 1200, height: 700 };
  const presentation = sandboxDocument(
    '',
    built.javascript,
    0,
    1,
    undefined,
    undefined,
    embeddedFontsHead
  );
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  // The host listens before the frame loads, so it hears the frame's first requests.
  await page.setContent(
    `<body style="margin:0">${servingScript(scenesOf(built), true)}<iframe sandbox="allow-scripts" style="display:block;width:${width}px;height:${height}px;border:0" srcdoc="${escape(presentation)}"></iframe></body>`
  );
  const frame = page.frames()[1];
  await settled(frame, 0);
  return {
    page,
    frame,
    send: (message) =>
      page.evaluate((message) => {
        document.querySelector('iframe')!.contentWindow!.postMessage(message, '*');
      }, message),
    messages: (type) =>
      page.evaluate(
        (type) =>
          (window as typeof window & { __messages: Record<string, unknown>[] }).__messages.filter(
            (message) => message?.type === type
          ),
        type
      )
  };
}

/**
 * Waits until the page, or a presentation in a frame of it, has settled at a step, or at whichever
 * step it shows when none is given.
 */
export async function settled(page: Page | Frame, step?: number): Promise<void> {
  await page.waitForFunction(
    (step) => {
      const at = document.getElementById('app')?.dataset.svSettled;
      return at !== undefined && (step === null || at === String(step));
    },
    step ?? null,
    { timeout: settleTimeout }
  );
}

/** Asks the page for a step, as the app does, and waits until it has settled there. */
export async function showStep(page: Page, step: number): Promise<void> {
  await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
  await settled(page, step);
}
