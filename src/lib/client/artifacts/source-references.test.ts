import { describe, expect, it } from 'vitest';

import { codeIn, codeMarkdown, diagnosticRanges, referenceRanges } from './source-references';

const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>
<script lang="sverlin">
  for (let i = Index(1); Before(i, end); i = Next(i)) @compare{
    if (Greater(values[@left[Prev(i)]], values[@right[i]])) @swap{
      const moved = @held[values[Prev(i)]];
    }
  }
</script>
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{#snippet Row(list: Values)}
  {#snippet Under()}<Node>i</Node>{/snippet}
{/snippet}
{@render Index(@left)}
{@render Index(@right)}
{@render Int(@swap.held)}`;

/** The text each region covers. */
const named = (text: string) =>
  referenceRanges(source, text).map(({ from, to }) => source.slice(from, to));

describe('references in messages', () => {
  it('name a snippet by its declaration, nested ones by their path', () => {
    expect(named('Highlight')).toEqual(['Highlight']);
    expect(named('Row.Under')).toEqual(['Under']);
    expect(referenceRanges(source, 'Highlight')[0].from).toBe(source.indexOf('Highlight(p'));
  });

  it('name a declaration in a script', () => {
    expect(named('Greater')).toEqual(['Greater']);
    expect(referenceRanges(source, 'Greater')[0].from).toBe(source.indexOf('Greater = binop'));
    expect(named('moved')).toEqual(['moved']);
  });

  it('name a label where it labels code and where the view reads it', () => {
    expect(named('@left')).toEqual(['@left', '@left']);
    expect(named('@swap.held')).toEqual(['@held', '@swap.held']);
  });

  it('name a design variable by its kind and place', () => {
    expect(named('Highlight.Pointed.fill')).toEqual(['Highlight', '<Pointed']);
    expect(named('Highlight.Pointed@left.fill')).toEqual([
      'Highlight',
      '<Pointed',
      '{@render Index(@left)}'
    ]);
    expect(named('views.Int')).toEqual(['{@render Int(@swap.held)}']);
    expect(named('pointers.Index@right')).toEqual(['{@render Index(@right)}']);
  });

  it('name lines, a line and column, or a run of lines', () => {
    expect(named('line 12')).toEqual(['{#snippet Highlight(p: Index)}<Pointed />{/snippet}']);
    expect(named('12:11')).toEqual(['Highlight(p: Index)}<Pointed />{/snippet}']);
    expect(named('lines 16-17')).toEqual(['{@render Index(@left)}\n{@render Index(@right)}']);
    expect(named('line 99')).toEqual([]);
  });

  it('name code written as it is in the source', () => {
    expect(named('values[Prev(i)]')).toEqual(['values[Prev(i)]']);
  });

  it('name nothing for words, props, numbers, or names the source does not declare', () => {
    for (const text of ['fill', 'swap', 'the', '3', 'Arrow', '@missing', 'views.Missing', 'a > b?'])
      expect(named(text)).toEqual([]);
  });
});

describe('code in an error message', () => {
  const dotted = `<script lang="sverlin" listing="code">
  for i = 0 to n - 1
      @check[if A[i] == target:] @check.found[return i]
      @next[@found[return i]]
</script>
<script lang="sverlin">let i = Index(1);</script>
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{@render Highlight(@left)}`;
  const code = (text: string, inSource = dotted) =>
    codeIn(inSource, text).flatMap((span) => (span.code ? [span.text] : []));

  it('finds the region a dotted-name problem names, not the fix it suggests', () => {
    expect(
      code(
        'The region @check.found[ has a dotted name: a region takes one name and nests inside the one around it, as @check[… @found[…]].'
      )
    ).toEqual(['@check.found[']);
  });

  it('finds a render written with …, and leaves one the source has not as text', () => {
    expect(
      code(
        "{@render Highlight(…)} names the view Highlight, but which view draws a value is the variant's: render its type, as {@render Index(…)}, which pointers.Index chooses the view of."
      )
    ).toEqual(['{@render Highlight(…)}']);
    expect(named('Highlight(…)')).toEqual(['Highlight(p: Index)']);
  });

  it('finds nothing in a message without code, or code the source does not hold', () => {
    expect(code('The recorded steps are too large; use smaller state or fewer steps.')).toEqual([]);
    expect(code('Two snippets are named Under, as in Row.Under or views.Gone.')).toEqual([]);
  });

  it('writes the rest as text, so nothing in a message is markup', () => {
    const markdown = codeMarkdown(codeIn(dotted, '<Node> *at* the region @check.found[ [x](y)'));
    expect(markdown).toBe('\\<Node\\> \\*at\\* the region `@check.found[` \\[x\\]\\(y\\)');
  });
});

describe('problems of a build', () => {
  it('cover from their position to their end, or to the end of the line', () => {
    const ranges = diagnosticRanges(source, [
      { message: 'here', raw: 'here', severity: 'error', line: 16, column: 10 },
      {
        message: 'span',
        raw: 'span',
        severity: 'error',
        line: 12,
        column: 11,
        endLine: 12,
        endColumn: 20
      },
      { message: 'nowhere', raw: 'nowhere', severity: 'error', line: 99, column: 1 }
    ]);
    expect(ranges.map(({ from, to }) => source.slice(from, to))).toEqual([
      'Highlight',
      'Index(@left)}'
    ]);
  });
});
