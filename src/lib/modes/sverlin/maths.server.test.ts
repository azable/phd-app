import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { serverMeasure } from './fonts/measure.server';
import { fontList, fontValues } from './library/fonts';
import { readRegions } from './listing/mapped.server';
import { mathsSvg } from './maths-svg.server';
import { mathsCharacters, mathsText } from './maths.server';

const text = (latex: string) => {
  const converted = mathsText(latex);
  if ('problem' in converted) throw new Error(converted.problem);
  return converted.text;
};
const problem = (latex: string) => {
  const converted = mathsText(latex);
  return 'problem' in converted ? converted.problem : '';
};

describe('inline maths written as Unicode', () => {
  it.each([
    ['O(n \\log n)', 'O(n log n)'],
    ['O(n^2)', 'O(n²)'],
    ['\\Theta(n)', 'Θ(n)'],
    ['a_i \\le a_{i+1}', 'aᵢ ≤ aᵢ₊₁'],
    ['\\sum_{i=1}^n i = n(n+1)/2', '∑ᵢ₌₁ⁿ i = n(n+1)/2'],
    ['\\lceil \\log_2 n \\rceil', '⌈ log₂ n ⌉'],
    ['x \\in \\mathbb{N}', 'x ∈ ℕ'],
    ['\\langle u, v \\rangle', '⟨ u, v ⟩'],
    ['2^{n-1}', '2ⁿ⁻¹'],
    ['\\sqrt{n}', '√n'],
    ['\\infty \\to \\emptyset', '∞ → ∅'],
    ['\\text{if } i < j', 'if i < j']
  ])('writes %s as %s', (latex, unicode) => expect(text(latex)).toBe(unicode));

  it('refuses what has no form on one line, saying what to write', () => {
    expect(problem('\\frac{n}{2}')).toContain('write it on the line, as \\((n+1)/2\\)');
    expect(problem('A_{mid}')).toContain('Unicode has no subscript d');
    expect(problem('\\sqrt{n+1}')).toContain('\\sqrt{(n+1)}');
    expect(problem('\\sum\\limits_{i}')).toContain('leave out \\limits');
    expect(problem('\\foo')).toContain('\\foo is no maths command');
  });

  it('writes only characters every embedded face list can measure', () => {
    const measure = serverMeasure();
    const characters = [...mathsCharacters()].join(' ');
    for (const family of fontValues)
      measure.width(characters, `normal 400 16px ${fontList(family)}`);
    expect([...measure.missing]).toEqual([]);
  });

  it('draws maths in a caption as a Math node, and in a listing as its text', async () => {
    const caption = `<script algorithm>
</script>
<Layout name="Main"><Node><Node>It takes \\(O(n^2)\\) time, as \\(\\{a, b\\}\\) shows.</Node></Node></Layout>
<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`;
    const prepared = prepareSvelteComponent(caption);
    expect(Object.keys(prepared.design.space).some((key) => key.startsWith('Main.Math.'))).toBe(
      true
    );
    await bundlePresentation(prepared, 1, {});
    expect(readRegions('while @test[\\(a_i \\le key\\)]').text).toBe('while aᵢ ≤ key');
  });

  it('refuses an unclosed fence and a token inside maths', () => {
    const unclosed =
      'This inline maths is never closed: write it between $$ and $$, as $$O(n \\log n)$$.';
    expect(readRegions('if \\(a_i').problems.map(({ message }) => message)).toEqual([unclosed]);
    expect(readRegions('if $$a_i').problems.map(({ message }) => message)).toEqual([unclosed]);
    expect(readRegions('\\($i[i] + 1\\)').problems[0].message).toContain('inside maths');
    expect(readRegions('$$$i[i] + 1$$').problems[0].message).toContain('inside maths');
  });

  it('reads $$…$$ as maths, never as a token, and a lone $ as text', () => {
    expect(readRegions('while @test[$$a_i \\le key$$]').text).toBe('while aᵢ ≤ key');
    expect(readRegions('costs $5 and $$O(n)$$').text).toBe('costs $5 and O(n)');
  });
});

describe('inline maths drawn by MathJax', () => {
  it('draws a caption fraction and sum as one SVG each, sized in em with its baseline', () => {
    const drawn = mathsSvg('\\frac{n(n+1)}{2}');
    if (!('svg' in drawn)) throw new Error(drawn.problem);
    expect(drawn.svg).toMatch(
      /^<svg style="display: inline-block; vertical-align: -[\d.]+em; width: [\d.]+em; height: [\d.]+em;"/u
    );
    expect(drawn.svg).toContain('currentColor');
    expect(drawn.svg).not.toMatch(/\d+ex"/u);
    // The PDF draws the text in its place, the source where Unicode has no form for it.
    expect(drawn.text).toBe('\\frac{n(n+1)}{2}');
    const sum = mathsSvg('\\sum_{i=1}^{n} i');
    expect('svg' in sum && sum.text).toBe('∑ᵢ₌₁ⁿ i');
  });

  it("refuses TeX MathJax cannot read, with MathJax's reason", () => {
    const drawn = mathsSvg('\\frac{a');
    expect('problem' in drawn && drawn.problem).toMatch(/^\$\$\\frac\{a\$\$: .*/u);
  });

  it('builds a caption written $$…$$ and lays its SVG out on the server', async () => {
    const caption = `<script algorithm>
</script>
<Layout name="Main"><Node><Node>Pairs: $$\\frac{n(n-1)}{2}$$, so $$O(n^2)$$.</Node></Node></Layout>
<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`;
    const { labels } = await bundlePresentation(prepareSvelteComponent(caption), 1, {});
    expect(labels).toHaveLength(1);
  });
});
