/**
 * A view in a line of text whose look has a shadow sits in the line like any other view: the room
 * kept round it for the shadow is inline too, so the sentence keeps one line and nothing around it
 * moves as the sentence changes. Run with `pnpm run test:browser`.
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

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
  const target = Int;
</script>

<script algorithm>
  @start[let i = Index(0);]
  while (@check[values[i] !== target]) @next[i++;]
</script>

<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>

<Layout name="Main" of="values, i, target, @check, @next">
  <Node layout="column">
    <Node kind="Title">Linear search</Node>
    {values}
    <OneOf>
      <When of="@check"><Node>Is this {target}?</Node></When>
      <When of="@next"><Node>It is not {target}, so move on to the next value.</Node></When>
    </OneOf>
    {i}
  </Node>
</Layout>

<Case name="main" values={[7, 42, 3, 18, 25]} target={18} />

<Storyboard>
  <Scene name="main" case="main" pause="@check, @next"><Main values={values} i={i} target={target} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'keeps a shadowed view in its line of text, so nothing around the sentence moves',
  { timeout: 120_000 },
  async () => {
    const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1, {
      chosen: { 'Cell.shadow': 'hard' }
    });
    const page = await browser!.newPage({ viewport: { width: 900, height: 500 } });
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    const seen: { title: number; lines: number[] }[] = [];
    // Every step but the input as given and the end, where neither sentence shows.
    for (let step = 1; step < labels.length - 1; step++) {
      await page.evaluate(
        (to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'),
        step
      );
      await page.waitForTimeout(900);
      seen.push(
        await page.evaluate(() => {
          const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
          const title = layer.querySelector('[data-sv-kind$="Title"]')!.getBoundingClientRect();
          // Each shown sentence's text and inline view, by the top of their line boxes.
          const sentence = [...layer.querySelectorAll<HTMLElement>('[data-sv-kind^="Main"]')].find(
            (node) =>
              /this|move on/.test(node.textContent ?? '') &&
              node.dataset.svHidden !== 'true' &&
              !node.querySelector('[data-sv-kind^="Main"]')
          );
          // The words' own line boxes, outside the view, and how far the view's middle is from theirs.
          const words: DOMRect[] = [];
          const walker = document.createTreeWalker(sentence!, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim() || node.parentElement?.closest('[data-sv-kind="Cell"]'))
              continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            words.push(...range.getClientRects());
          }
          const view = sentence!.querySelector('[data-sv-kind="Cell"]')!.getBoundingClientRect();
          const middle = (rect: DOMRect) => rect.top + rect.height / 2;
          return {
            title: Math.round(title.top),
            lines: [
              new Set(words.map((rect) => Math.round(middle(rect)))).size,
              Math.abs(middle(view) - middle(words[0]))
            ]
          };
        })
      );
    }
    await page.close();

    // The title never moves, however the sentence below it changes.
    expect(new Set(seen.map(({ title }) => title)).size).toBe(1);
    // The words keep one line, and the view sits in it, not on a line of its own.
    for (const { lines } of seen) {
      expect(lines[0]).toBe(1);
      expect(lines[1]).toBeLessThan(4);
    }
  }
);
