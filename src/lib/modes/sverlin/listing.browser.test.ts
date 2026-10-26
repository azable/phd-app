/**
 * A listing's lit code drawn in a real browser, each region painted as its place says. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { colourCss } from './library/node/design';

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

const insertion = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Prev = unop((p: Position) => Position(p - 1));
  const Next = unop((p: Position) => Position(p + 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>
<script lang="sverlin" input>
  const values = Values([5, 2, 4, 1]);
</script>
<script lang="sverlin">
  for (let i = Position(1); Before(i, Length(values)); i = Next(i)) @insert{
    let j = i;
    while (Before(Position(0), j) && @compare[Greater(values[@left[Prev(j)]], values[@right[j]])]) @swap{
      const moved = values[@from[Prev(j)]];
      values[Prev(j)] = values[@to[j]];
      values[j] = moved;
      j = Prev(j);
    }
  }
</script>
<script lang="sverlin" listing="code">
  for i = 1 to length(A) - 1
    @insert[j = i
    while j > 0 and @compare[A[@left[j - 1]] > A[@right[j]]]
      @swap[moved = A[@from[j - 1]]
      A[j - 1] = A[@to[j]]
      A[j] = moved
      j = j - 1]]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Highlight(p: Position)}<Pointed />{/snippet}
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node>{#each values as v}{@render Int(v)}{/each}</Node>
  </Node>
{/snippet}
{@render Board()}
{@render Position(@insert.compare.left)}
{@render Position(@insert.compare.right)}
{@render Position(@insert.swap.from)}
{@render Position(@insert.swap.to)}`;

it.skipIf(!enabled)(
  'paints each region as its mark, in pills that move no text',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(insertion);
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: {
        'pause@insert': 'off',
        'pause@insert.compare': 'accumulate',
        'pause@insert.compare.left': 'on',
        'pause@insert.compare.right': 'on',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.from': 'off',
        'pause@insert.swap.to': 'on',
        'Highlight.Pointed@insert.compare.left.fill': 'sky-100',
        'Highlight.Pointed@insert.compare.right.fill': 'violet-100',
        'listing.lit.fill': 'amber-200',
        'listing.lit.stroke': 'amber-500',
        'listing.lit.strokeWidth': 1,
        'listing.lit.radius': 999,
        'listing.lit.padding': 0.25,
        'listing.lit@insert.swap.to.fill': 'red-200'
      }
    });
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    // Each lit piece's text and inline style, outermost first.
    const lit = () =>
      page.evaluate(
        (layer) =>
          [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-lit]`)].map((span) => ({
            text: span.textContent ?? '',
            style: span.getAttribute('style') ?? '',
            nested: Boolean(span.parentElement?.closest('[data-sv-lit]'))
          })),
        layer
      );
    // Where the first character of the listing's line holding A[j - 1] > A[j] sits, so lighting
    // moving no text can be checked.
    const where = () =>
      page.evaluate((layer) => {
        const line = [
          ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="listing-line"]`)
        ].find((node) => node.textContent?.includes('while'));
        if (!line) return undefined;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !text.textContent?.trim()) text = walker.nextNode();
        if (!text) return undefined;
        const at = (text.textContent ?? '').search(/\S/);
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        return range.getBoundingClientRect().left;
      }, layer);
    // Show a step, waiting for a piece lit outermost with this text.
    const go = async (step: number, text: string) => {
      await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
      await page.waitForFunction(
        ({ layer, text }) =>
          [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-lit]`)].some(
            (span) => span.textContent === text && !span.parentElement?.closest('[data-sv-lit]')
          ),
        { layer, text }
      );
    };
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    const before = await where();
    // The left operand: its code in the left cell's colour, a pill with an outline inside it.
    await go(1, 'j - 1');
    const left = (await lit()).find(({ text }) => text === 'j - 1');
    expect(left?.style).toContain(colourCss('sky-100'));
    expect(left?.style).toMatch(/border-radius: ?999px/);
    expect(left?.style).toContain(colourCss('amber-500'));
    expect(await where()).toBeCloseTo(before ?? 0, 0);
    // The right operand: the left one kept in its colour, the right in its own.
    await go(2, 'j');
    const right = await lit();
    expect(right.find(({ text, nested }) => text === 'j' && !nested)?.style).toContain(
      colourCss('violet-100')
    );
    expect(right.find(({ text }) => text === 'j - 1')?.style).toContain(colourCss('sky-100'));
    // The comparison as a whole, its operands drawn inside it where their colours differ.
    await go(3, 'A[j - 1] > A[j]');
    const compared = await lit();
    expect(compared.find(({ text }) => text === 'A[j - 1] > A[j]')?.style).toContain(
      colourCss('amber-200')
    );
    expect(compared.find(({ text }) => text === 'j - 1')).toMatchObject({ nested: true });
    // The swap's read of A[j], in the region's own red.
    await go(4, 'j');
    const read = await lit();
    expect(read.some(({ style }) => style.includes(colourCss('red-200')!))).toBe(true);
    expect(await where()).toBeCloseTo(before ?? 0, 0);
    // The whole swap: each of its four lines lit from its first character, never its indentation.
    await go(5, 'A[j] = moved');
    const swap = (await lit()).filter(({ nested }) => !nested).map(({ text }) => text);
    expect(swap).toEqual(
      expect.arrayContaining(['moved = A[j - 1]', 'A[j - 1] = A[j]', 'A[j] = moved', 'j = j - 1'])
    );
    expect(swap.every((text) => text === text.trim())).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }
);
