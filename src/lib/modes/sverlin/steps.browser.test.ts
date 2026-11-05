/**
 * Steps played in a real browser. Run with `pnpm run test:browser`, which the devenv gives a
 * browser (SVERLIN_TEST_BROWSER).
 */

import { expect, it } from 'vitest';

import { browserTestsOn as enabled, openPage, showStep, settled } from './testing/browser';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';

it.skipIf(!enabled)(
  'plays a step forward straight to the state after its code, in one motion',
  { timeout: 120_000 },
  async () => {
    // Each step is a write of 7; the loop moving i, which the view draws, leads up to it.
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[1, 1, 1]} />
<script algorithm>
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) {
    @write[values[i] = 7;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="IndexText"><Node value={this} /></View>
<Layout name="Cells" of="values"><Node>{#each values as v}{v}{/each}</Node></Layout>
<Layout name="At" of="i"><Node>at {i}</Node></Layout>

<Layout name="Main" of="values, i">
  <Node>
    <Cells values={values} />
    <At i={i} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@write"><Main values={values} i={i} /></Scene>
</Storyboard>`;
    const prepared = prepareSvelteComponent(pausingEveryLabel(source));
    // Step 0 is the input as given, before any of the algorithm runs.
    expect(prepared.master[0].state.values).toEqual([1, 1, 1]);
    // The loop header is labelled part by part; the write is the step, the header leading up to it.
    const second = prepared.master.find(({ name }) => name === '@write#2')!;
    expect(second.before?.state).toMatchObject({ values: [7, 1, 1], i: 1 });
    expect(second.state.values).toEqual([7, 7, 1]);
    const { javascript } = await bundlePresentation(prepared, 1, {});
    const page = await openPage({ viewport: { width: 1200, height: 700 } });
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
    // Stepping forward shows the next step's after at once, the loop moving i with it. Every
    // frame drawn on the way is recorded in the page, until the step has settled.
    await settled(page, 1);
    await page.evaluate(() => {
      const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
      const seen: string[][] = [];
      (window as unknown as { seen: string[][] }).seen = seen;
      const record = () => {
        const at = document.querySelector<HTMLElement>(`${layer} [data-sv-kind="IndexText"]`);
        const now = [
          at?.innerText.trim() ?? '',
          ...[...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`)].map(
            (node) => node.innerText.trim()
          )
        ];
        if (now.length > 1 && seen.at(-1)?.join() !== now.join()) seen.push(now);
        if (document.getElementById('app')?.dataset.svSettled !== '2')
          requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await showStep(page, 2);
    const seen = await page.evaluate(() => (window as unknown as { seen: string[][] }).seen);
    expect(await shown()).toEqual(seen.at(-1));
    expect(errors).toEqual([]);
    // From the step before, i moving and the 7 its code writes show together.
    expect(seen.map((values) => values.join(' '))).toEqual(['0 7 1 1', '1 7 7 1']);
  }
);

it.skipIf(!enabled)(
  'leaves out a value out of scope at every step with the node around it, as shown false does',
  { timeout: 120_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[3, 1]} />
<script algorithm>
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) @pass{
    @pick[const key = values[i];]
    @put[values[i] = key;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Title"><Node>Pass</Node></Layout>
<Layout name="Key" of="key"><Node>key {key}</Node></Layout>
<Layout name="Cells" of="values"><Node layout="row">{#each values as x}{x}{/each}</Node></Layout>

<Layout name="Main" of="key, values">
  <Node>
    <Title />
    <Key key={key} />
    <Cells values={values} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@pass.pick, @pass.put"><Main key={key} values={values} /></Scene>
</Storyboard>`;
    // The pass as one label, which reads key and writes the row: its steps are its passes that
    // change the row, key out of scope before each and after it.
    const whole = source
      .replace(
        '@pick[const key = values[i];]\n    @put[values[i] = key;]',
        'const key = values[i];\n    values[i] = values[0];'
      )
      .replace('pause="@pass.pick, @pass.put"', 'pause="@pass"');
    const kinds = async (text: string, chosen: Record<string, string | boolean> = {}) => {
      const prepared = prepareSvelteComponent(pausingEveryLabel(text));
      const { javascript } = await bundlePresentation(prepared, 1, { chosen });
      const page = await openPage({ viewport: { width: 1200, height: 700 } });
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
