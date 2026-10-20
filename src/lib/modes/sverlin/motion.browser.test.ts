/**
 * Moves between steps, in a real browser: two presentations stacked in sandboxed frames, as the
 * comparison view shows them, stepped together. The second of two frames is drawn less often, so
 * a step there can settle before the frame has fitted it, and its moves then start from the wrong
 * place; only a browser shows that. Run with `pnpm run test:browser`, which the devenv gives a
 * browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser, type Frame } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

const merge = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
</script>
<script lang="sverlin" input>
  const left = Values([1, 4, 7]);
  const right = Values([2, 3, 9]);
</script>
<script lang="sverlin">
  let merged = Values([]);
  let i = Position(left, 0);
  let j = Position(right, 0);
  yield;
  while (i < left.length || j < right.length) {
    if (j === right.length || (i < left.length && left[i] < right[j])) {
      merged.push(left[i]);
      i++;
    } else {
      merged.push(right[j]);
      j++;
    }
    const k = Position(merged, merged.length - 1);
    yield;
  }
</script>
<script lang="sverlin" design>
  const Int = pick([IntText, IntCard]);
</script>
{#snippet IntText(value: Int)}<Node {value} />{/snippet}
{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}
{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Arrow(p: Position)}<Node layout="column"><Pointed /><Node size="small">↑</Node></Node>{/snippet}
{#snippet Placed(p: Position)}<Pointed fill="amber" />{/snippet}
<Node layout="column" align="start">{@render Row(left)}{@render Row(right)}{@render Row(merged)}</Node>
{@render Arrow(i)}
{@render Arrow(j)}
{@render Placed(k)}`;

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

/** Where each visible node with an identity is, by identity, on the layer shown. */
function placed(frame: Frame): Promise<Record<string, [number, number]>> {
  return frame.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
    return Object.fromEntries(
      [...(layer?.querySelectorAll<HTMLElement>('[data-sv-identity]') ?? [])].map((node) => {
        const box = node.getBoundingClientRect();
        return [node.dataset.svIdentity, [Math.round(box.left), Math.round(box.top)]];
      })
    );
  });
}

/** Where each moving node starts, held at the start of its move, with the value it was copied from. */
function starts(
  frame: Frame
): Promise<{ identity: string; at: [number, number]; copiedFrom?: string }[]> {
  return frame.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
    const moves = (layer?.getAnimations({ subtree: true }) ?? []).filter(
      (animation) => (animation.effect as KeyframeEffect).getKeyframes()[0].translate !== undefined
    );
    for (const move of moves) {
      move.pause();
      move.currentTime = 0;
    }
    return moves.map((move) => {
      const node = (move.effect as KeyframeEffect).target as HTMLElement;
      const box = node.getBoundingClientRect();
      return {
        identity: node.dataset.svIdentity ?? '',
        at: [Math.round(box.left), Math.round(box.top)] as [number, number]
      };
    });
  });
}

it.skipIf(!enabled)(
  'starts every move between steps where the node was, in both of two stacked frames',
  { timeout: 180_000 },
  async () => {
    const prepared = prepareSvelteComponent(merge);
    // Copies start where the value they were copied from was (identities.server.ts).
    const copies = prepared.master.map(({ identities }) => identities?.copies ?? {});
    const frames = await Promise.all(
      [1, 2].map(async (seed) => {
        const { javascript } = await bundlePresentation(prepared, seed);
        return sandboxDocument('', javascript, 0, seed);
      })
    );
    const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    for (const [width, height] of [
      [1300, 300],
      [700, 380]
    ]) {
      const page = await browser!.newPage({ viewport: { width, height: 2 * height + 8 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        `<body style="margin:0;display:flex;flex-direction:column;gap:8px">${frames
          .map(
            (document) =>
              `<iframe sandbox="allow-scripts" style="width:${width}px;height:${height}px;border:0" srcdoc="${escape(document)}"></iframe>`
          )
          .join('')}</body>`
      );
      const step = (index: number) =>
        page.evaluate((index) => {
          for (const frame of document.querySelectorAll('iframe'))
            frame.contentWindow?.postMessage(
              { type: 'sverlin:step', step: index, selection: [] },
              '*'
            );
        }, index);
      const panes = page.frames().slice(1);
      await step(0);
      for (const pane of panes)
        await pane.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
          timeout: 60_000
        });

      for (let index = 1; index < prepared.master.length; index++) {
        const before = await Promise.all(panes.map(placed));
        await step(index);
        for (const [pane, frame] of panes.entries()) {
          await frame.waitForFunction(
            () =>
              document
                .querySelector('.sv-layer:not(.pending):not(.sv-leaving)')
                ?.getAnimations({ subtree: true }).length,
            null,
            { timeout: 20_000 }
          );
          for (const { identity, at } of await starts(frame)) {
            const from = before[pane][identity] ?? before[pane][copies[index][Number(identity)]];
            expect(at, `step ${index + 1}, frame ${pane + 1}, identity ${identity}`).toEqual(from);
          }
          await frame.evaluate(() => {
            for (const animation of document.getAnimations()) animation.finish();
          });
        }
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }
);
