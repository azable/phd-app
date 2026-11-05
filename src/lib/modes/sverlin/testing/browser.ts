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

/** Opens a built presentation at a step and waits until it has settled there. */
export async function openPresentation(
  javascript: string,
  options: PageOptions & {
    step?: number;
    head?: string;
    errors?: string[];
    /** Draw the steps from their scene data (library/SceneView.svelte), as `?scenes=1` does. */
    scenes?: boolean;
  } = {}
): Promise<Page> {
  const page = await openPage(options);
  if (options.errors) page.on('pageerror', (error) => options.errors!.push(error.message));
  await page.setContent(
    sandboxDocument('', javascript, options.step ?? 0, 1, undefined, undefined, options.head, {
      scenes: options.scenes
    })
  );
  await settled(page, options.step ?? 0);
  return page;
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

/**
 * Asks for a step and holds its motion at a fraction of its length, for tests about motion: every
 * animation of the step is paused and set to that point of its own timing, so what it samples does
 * not depend on how busy the machine is. `finishMotion` lets the step end.
 */
export async function holdMotion(page: Page, step: number, fraction: number): Promise<void> {
  await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
  await page.waitForFunction(() => document.getAnimations().length > 0, null, {
    timeout: settleTimeout
  });
  await page.evaluate((fraction) => {
    for (const animation of document.getAnimations()) {
      const { delay = 0, duration } = animation.effect?.getTiming() ?? {};
      animation.pause();
      if (typeof duration === 'number') animation.currentTime = delay + duration * fraction;
    }
  }, fraction);
}

/** Lets held motion finish, and waits until the page has settled at the step. */
export async function finishMotion(page: Page, step: number): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await settled(page, step);
}
