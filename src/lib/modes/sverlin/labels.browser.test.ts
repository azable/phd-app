/**
 * Labels as values, and what has happened, in a real browser. Run with `pnpm run test:browser`,
 * which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { expect, it } from 'vitest';

import { browserTestsOn as enabled, openPage, showStep } from './testing/browser';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';

const domain = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>`;

/** Each step's visible nodes, as kind:text, from the first step on. */
async function stepsOf(source: string, count: number): Promise<string[][]> {
  const prepared = prepareSvelteComponent(pausingEveryLabel(source));
  const { javascript } = await bundlePresentation(prepared, 1, {});
  const page = await openPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const steps: string[][] = [];
  for (let step = 0; step < count; step++) {
    await showStep(page, step);
    steps.push(
      await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]'
          )
        ]
          .filter((node) => getComputedStyle(node).visibility !== 'hidden')
          .map((node) => `${node.dataset.svKind}:${node.innerText.replace(/\s+/gu, ' ').trim()}`)
      )
    );
  }
  await page.close();
  expect(errors).toEqual([]);
  return steps;
}

it.skipIf(!enabled)(
  'show the key each step of a whole insertion inserted, though out of scope at its after',
  { timeout: 120_000 },
  async () => {
    const source = `${domain}
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 8, 1]} />
<script algorithm>
  for (@first[let i = Index(1)]; @more[i < values.length]; @next[i++]) @insert{
    const key = @key[values[i]];
    let j = i;
    while (@shift[(Index(0) < j) && ((values[j - 1]) > key)]) {
      values[j] = values[j - 1];
      j--;
    }
    values[j] = key;
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Cells" of="values"><Node>{#each values as v}{v}{/each}</Node></Layout>
<Layout name="Inserting" of="@insert.key"><Node>inserting {@insert.key}</Node></Layout>

<Layout name="Main" of="values, @insert.key">
  <Node>
    <Cells values={values} />
    <Inserting />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@insert"><Main values={values} /></Scene>
</Storyboard>`;
    const keys = (await stepsOf(source, 4)).map((nodes) =>
      nodes.find((node) => node.startsWith('Inserting'))
    );
    // The page opens on the input, before any key, the node hidden whole; then one key per step.
    expect(keys).toEqual([
      undefined,
      'Inserting:inserting 2',
      'Inserting:inserting 8',
      'Inserting:inserting 1'
    ]);
  }
);

it.skipIf(!enabled)(
  'say what a swap swapped, from the values its code read before the exchange',
  { timeout: 120_000 },
  async () => {
    const source = `${domain}
<script input>
  const values = Values;
</script><Case name="main" values={[5, 1, 4]} />
<script algorithm>
  for (@last[let end = values.length]; @more[Index(1) < end]; @shrink[end--]) @sweep{
    for (@first[let i = Index(1)]; @inside[i < end]; @step[i++]) @pair{
      if (@test[(values[i - 1]) > values[i]]) @swap{
        const moved = @a[values[i - 1]];
        values[i - 1] = @b[values[i]];
        values[i] = moved;
      }
    }
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Cells" of="values"><Node>{#each values as v}{v}{/each}</Node></Layout>
<Layout name="Swapped" of="@sweep.pair.swap.a, @sweep.pair.swap.b"><Node>swap {@sweep.pair.swap.a} and {@sweep.pair.swap.b}</Node></Layout>
<View of="@sweep.pair.test" name="Ask"><Node>is {this.left} > {this.right}?</Node></View>

<Layout name="Main" of="values, @sweep.pair.test, @sweep.pair.swap.a, @sweep.pair.swap.b">
  <Node>
    <Cells values={values} />
    {@sweep.pair.test}
    <Swapped />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@sweep.pair.test, @sweep.pair.swap"><Main values={values} /></Scene>
</Storyboard>`;
    // Pausing at each comparison and each swap, which gives both values the caption draws.
    // [5, 1, 4]: the first sweep swaps twice; the second sweep's 1 > 4 swaps nothing.
    const [, compare, swap, , , last] = await stepsOf(source, 6);
    expect(swap).toContain('Swapped:swap 5 and 1');
    // At a comparison, the caption hides whole, its text with its values.
    expect(compare.some((node) => node.startsWith('Swapped'))).toBe(false);
    expect(last.some((node) => node.startsWith('Swapped'))).toBe(false);
    expect(last.some((node) => node.startsWith('Ask:is 1 > 4'))).toBe(true);
  }
);

it.skipIf(!enabled)(
  'mark every cell a search has checked so far, and point from a loop variable',
  { timeout: 120_000 },
  async () => {
    const search = `${domain}
<script input>
  const values = Values;
  const target = Int;
</script><Case name="main" values={[3, 8, 5, 2]} target={5} />
<script algorithm>
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) @check{
    if (@hit[values[@at[i]] === target]) break;
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="Checked"><Pointed /></View>
<Layout name="Cells" of="values"><Node>{#each values as v}{v}{/each}</Node></Layout>

<Layout name="Main" of="values, @check.hit.at">
  <Node>
    <Cells values={values} />
    {#each spans(@check.hit.at) as p}{p}{/each}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@check"><Main values={values} /></Scene>
</Storyboard>`;
    const checked = (await stepsOf(search, 4)).map((nodes) =>
      nodes.filter((node) => node.startsWith('Checked')).map((node) => node.split(':')[1])
    );
    // The input as given, nothing checked yet; then each check adds its cell.
    expect(checked).toEqual([[], ['3'], ['3', '8'], ['3', '8', '5']]);

    const counting = `<script domain>
  const Digit = type('integer', { min: 0, max: 9 });
  const Count = type('integer', { min: 0, max: 9 });
  const Digits = array(Digit, { max: 8 });
  const Counts = array(Count, { max: 8 });
  const At = index(Digits);
</script>
<script input>
  const digits = Digits;
  const counts = Counts;
</script><Case name="main" digits={[3, 1, 4]} counts={[0, 0, 0, 0, 0]} />
<script algorithm>
  for (@first[let v = At(0)]; @more[v < digits.length]; @next[v++]) @count{ counts[digits[v]]++; }
</script>
<View of="Digit" name="DigitCell"><Node value={this} /></View>
<View of="Count" name="CountCell"><Node value={this} /></View>
<View of="At" name="Reading"><Pointed /></View>
<Layout name="DigitRow" of="digits"><Node>{#each digits as d}{d}{/each}</Node></Layout>
<Layout name="CountRow" of="counts"><Node>{#each counts as c}{c}{/each}</Node></Layout>

<Layout name="Main" of="v, digits, counts">
  <Node>
    <DigitRow digits={digits} />
    <CountRow counts={counts} />
    {v}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@count"><Main v={v} digits={digits} counts={counts} /></Scene>
</Storyboard>`;
    const reading = (await stepsOf(counting, 4)).map(
      (nodes) => nodes.find((node) => node.startsWith('Reading'))?.split(':')[1]
    );
    // The page opens on the input as given, v not yet declared; then each digit counted.
    expect(reading).toEqual([undefined, '3', '1', '4']);
  }
);
