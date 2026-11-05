/**
 * Every option a design space offers draws: for every fixture, each view or pointer drawn as none
 * and each kind left out (shown false), one at a time, lays out and shows every step without a
 * runtime error, and every step is sound (see library/soundness.ts). Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { expect, it } from 'vitest';

import { browserTestsOn as enabled, openPage } from './testing/browser';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';
import type { SceneFrame, SceneStep } from './library';
import { unsound } from './library/soundness';

const fixtures = import.meta.glob<string>('./fixtures/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});

/** The values that leave something out: a view or pointer drawn as none, a kind not shown. */
function leavingOut(
  space: Readonly<Record<string, readonly unknown[]>>,
  starter: Readonly<Record<string, unknown>>
): [string, unknown][] {
  return Object.entries(space).flatMap(([key, options]): [string, unknown][] => {
    if (/^(views|pointers)\./u.test(key) && options.includes('none') && starter[key] !== 'none')
      return [[key, 'none']];
    if (key.endsWith('.shown') && options.includes(false) && starter[key] !== false)
      return [[key, false]];
    return [];
  });
}

/** The runtime errors a presentation reports while it lays out and describes every step. */
async function problemsOf(javascript: string): Promise<string[]> {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const page = await openPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.route('https://sverlin.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<body style="margin:0"><script>window.__errors = []; addEventListener("message", ({ data }) => { if (data?.type === "sverlin:error") window.__errors.push("step " + data.step + ": " + data.message); });</script><iframe sandbox="allow-scripts" style="width:1200px;height:800px;border:0" srcdoc="${escape(sandboxDocument('', javascript, 0, 1))}"></iframe></body>`
      })
    );
    await page.goto('https://sverlin.test/');
    const { errors, frame, steps, failure } = await page.evaluate(
      () =>
        new Promise<{
          errors: string[];
          frame?: SceneFrame;
          steps?: SceneStep[];
          failure?: string;
        }>((resolve) => {
          addEventListener('message', ({ data }) => {
            const errors = (window as unknown as { __errors: string[] }).__errors;
            if (data?.type === 'sverlin:scene') resolve({ errors, ...data });
          });
          document
            .querySelector('iframe')
            ?.contentWindow?.postMessage({ type: 'sverlin:describe', request: 'options' }, '*');
        })
    );
    return [
      ...errors,
      ...(failure ? [`describing: ${failure}`] : []),
      ...(frame && steps ? steps.flatMap((step) => unsound(frame, step)) : [])
    ];
  } finally {
    await page.close();
  }
}

for (const [path, source] of Object.entries(fixtures)) {
  const name = path.replace(/^.*\/(.*)\.sverlin$/u, '$1');
  it.skipIf(!enabled)(
    `draws ${name} with each view, pointer and kind left out`,
    { timeout: 600_000 },
    async () => {
      const prepared = prepareSvelteComponent(pausingEveryLabel(source));
      const cases = leavingOut(prepared.design.space, prepared.design.starter);
      const failed: Record<string, string[]> = {};
      // A few pages at once: each case is its own presentation.
      const queue = [...cases];
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const [key, value] = next;
            const { javascript } = await bundlePresentation(prepared, 1, {
              chosen: { [key]: value }
            });
            const problems = await problemsOf(javascript);
            if (problems.length) failed[`${key}=${String(value)}`] = problems.slice(0, 3);
          }
        })
      );
      expect(failed).toEqual({});
    }
  );
}
