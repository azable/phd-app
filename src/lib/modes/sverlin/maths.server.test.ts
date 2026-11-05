import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { serverMeasure } from './fonts/measure.server';
import { fontList, fontValues } from './library/fonts';
import { readRegions } from './listing/mapped.server';
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

  it('refuses an unclosed \\( and a token inside maths', () => {
    const { problems } = readRegions('if \\(a_i');
    expect(problems.map(({ message }) => message)).toEqual([
      'This \\( is never closed with \\): write inline maths as \\(O(n \\log n)\\).'
    ]);
    expect(readRegions('\\($i[i] + 1\\)').problems[0].message).toContain('inside maths');
  });
});
