/**
 * Nodes and references drawn in a real browser: a node's next as an arrow from the node its view
 * draws, the end drawn by its own view, and a node nothing refers to leaving the page. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
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

const list = (algorithm: string) => `<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C']);
  const Flag = type('boolean');
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
  const IsNode = unop((p: Next) => Flag(p !== 'end'));
</script>
<script lang="sverlin" input>
  const head = NodeRef(ListNode({ name: 'A', next:
    NodeRef(ListNode({ name: 'B', next: NodeRef(ListNode({ name: 'C', next: End('end') })) })) }));
</script>
<script lang="sverlin">${algorithm}</script>
{#snippet NameCell(value: Name)}<Node {value} />{/snippet}
{#snippet EndMark(e: End)}<Node>∅</Node>{/snippet}
{#snippet NodeBox(n: ListNode)}
  {#snippet NextField()}<Node><Link to={n.next} /></Node>{/snippet}
  <Node layout="row">{@render Name(n.name)}{@render NextField()}</Node>
{/snippet}
{#snippet Heap()}<Node layout="free" flow="x">{#each all(ListNode) as n}{@render ListNode(n)}{/each}</Node>{/snippet}
{@render Heap()}`;

/** Each step's arrows, between the names of the nodes they join, and its nodes' text. */
async function play(source: string, count: number) {
  const prepared = prepareSvelteComponent(source);
  const { javascript } = await bundlePresentation(prepared, 1, {});
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const steps: { arrows: string[]; nodes: string[]; attached: string[] }[] = [];
  for (let step = 0; step < count; step++) {
    await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
    await page.waitForTimeout(2500);
    steps.push(
      await page.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
        const name = (slot: string) =>
          layer.querySelector<HTMLElement>(`[data-sv-slot="${slot}.name"]`)?.innerText.trim();
        // Where each arrow starts and ends on the page, and the field or name cell it is at there.
        const near = (point: DOMPoint, kind: string) =>
          [...layer.querySelectorAll<HTMLElement>(`[data-sv-kind="${kind}"]`)].find((node) => {
            const box = node.getBoundingClientRect();
            return (
              point.x >= box.left - 4 &&
              point.x <= box.right + 4 &&
              point.y >= box.top - 4 &&
              point.y <= box.bottom + 4
            );
          });
        const ends = (path: SVGPathElement) => {
          const matrix = path.getScreenCTM()!;
          const at = (length: number) => {
            const { x, y } = path.getPointAtLength(length);
            return new DOMPoint(x, y).matrixTransform(matrix);
          };
          const [start, end] = [at(0), at(path.getTotalLength())];
          const from = near(start, 'NodeBox.NextField')?.closest<HTMLElement>(
            '[data-sv-kind="NodeBox"]'
          )?.dataset.svSlot;
          const to = near(end, 'NameCell');
          return `${(from && name(from)) || '?'}→${to?.innerText.trim() || '?'}`;
        };
        const edges = [...layer.querySelectorAll<SVGPathElement>('path[data-sv-edge]')];
        return {
          arrows: edges
            .map((path) => path.dataset.svEdge!.split(' -> ').map(name).join('→'))
            .sort(),
          attached: edges.map(ends).sort(),
          nodes: [...layer.querySelectorAll<HTMLElement>('[data-sv-kind="NodeBox"]')]
            .map((node) => node.innerText.replace(/\s+/gu, ' ').trim())
            .sort()
        };
      })
    );
  }
  await page.close();
  expect(errors).toEqual([]);
  return steps;
}

it.skipIf(!enabled)(
  "draws each node's next as an arrow, and the end with its view, as a list is reversed",
  { timeout: 120_000 },
  async () => {
    const steps = await play(
      list(`
  let prev = Next(End('end'));
  let cur = Next(head);
  while (IsNode(cur)) @rewire{
    const after = cur.next;
    cur.next = prev;
    prev = cur;
    cur = after;
  }`),
      4
    );
    expect(steps.map(({ arrows }) => arrows)).toEqual([
      ['A→B', 'B→C'],
      ['B→C'],
      ['B→A'],
      ['B→A', 'C→B']
    ]);
    // Each arrow leaves its node's next field and meets the name of the node it points at.
    expect(steps.map(({ attached }) => attached)).toEqual(steps.map(({ arrows }) => arrows));
    // The end is drawn by its view where a node's next is the end.
    expect(steps[0].nodes).toEqual(['A', 'B', 'C ∅']);
    expect(steps[3].nodes).toEqual(['A ∅', 'B', 'C']);
  }
);

it.skipIf(!enabled)(
  'leaves out a node nothing refers to any more',
  { timeout: 120_000 },
  async () => {
    const steps = await play(list(`@unlink[head.next = head.next.next;]`), 2);
    expect(steps[0].nodes).toEqual(['A', 'B', 'C ∅']);
    expect(steps[1].nodes).toEqual(['A', 'C ∅']);
    expect(steps[1].arrows).toEqual(['A→C']);
    // Drawn from A's field to C, not along the route B's link to C had.
    expect(steps[1].attached).toEqual(['A→C']);
  }
);
