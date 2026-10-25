/**
 * Steps played in a real browser. Run with `pnpm run test:browser`, which the devenv gives a
 * browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

it.skipIf(!enabled)(
  'plays a step forward as the state before its code, then the state after it',
  { timeout: 120_000 },
  async () => {
    // Each step is a write of 7; the loop moving i, which the view draws, leads up to it.
    const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
</script>
<script lang="sverlin" input>
  const values = Values([1, 1, 1]);
</script>
<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) {
    @write[values[i] = 7;]
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IndexText(p: Index)}<Node value={p} />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet At()}<Node>at {@render Index(i)}</Node>{/snippet}
{#snippet Count()}<Node>step {step}</Node>{/snippet}
{@render Cells()}
{@render At()}
{@render Count()}`;
    const prepared = prepareSvelteComponent(source);
    // Step 0 is the input as given, before any of the algorithm runs.
    expect(prepared.master[0].state.values).toEqual([1, 1, 1]);
    expect(prepared.master[2].before?.state).toMatchObject({ values: [7, 1, 1], i: 1 });
    expect(prepared.master[2].state.values).toEqual([7, 7, 1]);
    const { javascript } = await bundlePresentation(prepared, 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const cells = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="IntCell"]'
          )
        ].map((node) => node.innerText.trim())
      );
    // Where i is, then the cells.
    const shown = () =>
      page.evaluate(() => {
        const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
        const at = document.querySelector<HTMLElement>(`${layer} [data-sv-kind="IndexText"]`);
        const values = [
          ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`)
        ].map((node) => node.innerText.trim());
        return [at?.innerText.trim() ?? '', ...values];
      });
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    expect(await cells()).toEqual(['1', '1', '1']);
    // The view's step counts steps, whatever state of one is drawn.
    const count = () =>
      page.evaluate(() =>
        document
          .querySelector<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="Count"]'
          )
          ?.innerText.trim()
      );
    expect(await count()).toBe('step 0');
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="IntCell"]'
          )
        ]
          .map((node) => node.innerText.trim())
          .join(' ') === '7 1 1'
    );
    expect(await count()).toBe('step 1');
    // Stepping forward shows the next step's before first, then its after.
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 2 }, '*'));
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]')
          .length > 0
    );
    const seen: string[][] = [];
    for (let poll = 0; poll < 40; poll++) {
      const now = await shown();
      if (!seen.length || seen.at(-1)!.join() !== now.join()) seen.push(now);
      await page.waitForTimeout(50);
    }
    expect(errors).toEqual([]);
    // From the step before, i moving leading up to the step shows first, then the 7 its code
    // writes.
    expect(seen.map((values) => values.join(' '))).toEqual(['0 7 1 1', '1 7 1 1', '1 7 7 1']);
  }
);

it.skipIf(!enabled)(
  'leaves out a value out of scope at every step with the node around it, as shown false does',
  { timeout: 120_000 },
  async () => {
    const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
</script>
<script lang="sverlin" input>
  const values = Values([3, 1]);
</script>
<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @pass{
    @pick[const key = values[i];]
    @put[values[i] = key;]
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Title()}<Node>Pass</Node>{/snippet}
{#snippet Key()}<Node>key {@render Int(key)}</Node>{/snippet}
{#snippet Cells()}<Node layout="row">{#each values as x}{@render Int(x)}{/each}</Node>{/snippet}
{@render Title()}
{@render Key()}
{@render Cells()}`;
    // The pass as one label, which reads key and writes the row: its steps are its passes that
    // change the row, key out of scope before each and after it.
    const whole = source.replace(
      '@pick[const key = values[i];]\n    @put[values[i] = key;]',
      'const key = values[i];\n    values[i] = values[0];'
    );
    const kinds = async (text: string, chosen: Record<string, string | boolean> = {}) => {
      const prepared = prepareSvelteComponent(text);
      const { javascript } = await bundlePresentation(prepared, 1, { chosen });
      const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
      await page.setContent(sandboxDocument('', javascript, 0, 1));
      await page.waitForFunction(() =>
        document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
      );
      const drawn = await page.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending)')!;
        return {
          kinds: [...layer.querySelectorAll<HTMLElement>('[data-sv-kind]')].map(
            (node) => node.dataset.svKind
          ),
          text: (layer as HTMLElement).innerText
        };
      });
      await page.close();
      return drawn;
    };
    // Stepping over each pass whole, key is out of scope at every step: no key node, no "key".
    const passes = await kinds(whole);
    expect(passes.kinds).not.toContain('Key');
    expect(passes.text).not.toContain('key');
    expect(passes.kinds).toContain('Title');
    // Stepping at the pick inside the pass, which declares key, key shows.
    const inside = await kinds(source);
    expect(inside.kinds).toContain('Key');
    // A kind not shown takes the nodes holding only its values with it: the row, and the key.
    const hidden = await kinds(source, { 'IntCell.shown': false });
    expect(hidden.kinds).not.toContain('Cells');
    expect(hidden.kinds).not.toContain('Key');
    expect(hidden.kinds).toContain('Title');
  }
);
