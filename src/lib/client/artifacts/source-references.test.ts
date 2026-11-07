import { describe, expect, it } from 'vitest';

import {
  codeIn,
  codeMarkdown,
  diagnosticRanges,
  elidedName,
  ghostKey,
  referenceRanges
} from './source-references';

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Greater = type('boolean');
</script>
<script algorithm>
  for (let i = Index(1); Before(i, end); i = Next(i)) @compare{
    if (values[@left[i - 1]] > values[@right[i]]) @swap{
      const moved = @held[values[Prev(i)]];
    }
  }
</script>
<View of="Index" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<View of="Values" name="Row">
  <Node kind="Under">i</Node><Node kind="Label">v</Node>
</View>
<Layout name="Main">
  <Node>
    {@compare.left}
    {@compare.right}
    {@compare.swap.held}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main"><Main /></Scene>
</Storyboard>`;

/** The text each region covers. */
const named = (text: string) =>
  referenceRanges(source, text).map(({ from, to }) => source.slice(from, to));

describe('references in messages', () => {
  it('name a view or layout by its declaration, a kind by its path', () => {
    expect(named('Highlight')).toEqual(['Highlight']);
    expect(named('Row.Under')).toEqual(['Under']);
    expect(named('Row.Label.fill')).toEqual(['Label']);
    expect(referenceRanges(source, 'Highlight')[0].from).toBe(source.indexOf('Highlight"'));
  });

  it('name a declaration in a script', () => {
    expect(named('Greater')).toEqual(['Greater']);
    expect(referenceRanges(source, 'Greater')[0].from).toBe(source.indexOf('Greater = type'));
    expect(named('moved')).toEqual(['moved']);
  });

  it('name a label where it labels code and where the view reads it', () => {
    expect(named('@compare.left')).toEqual(['@left', '@compare.left']);
    expect(named('@compare.swap.held')).toEqual(['@held', '@compare.swap.held']);
  });

  it('name a label by its full path, never another with the same last name', () => {
    const twice = `<script algorithm>
  for (let i = Index(1); Before(i, end); i = Next(i)) @rise{
    if (@compare[(values[@left[Prev(i)]]) > values[i]]) { const s = "@left[x]"; }
  }
  for (let i = Index(1); Before(i, end); i = Next(i)) @fall{
    if (@compare[Less(values[@left[Prev(i)]], values[i])]) {}
  }
</script>
<script listing="code">
  @rise[if @compare[A[@left[i - 1]] > A[i]]]
  @fall[if @compare[A[@left[i - 1]] < A[i]]]
</script>
<Layout name="Main">
  <Node>
    {@render Index(@rise.compare.left)}
    {@render Index(@fall.compare.left)}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main"><Main /></Scene>
</Storyboard>`;
    const at = (label: string) => referenceRanges(twice, label).map(({ from }) => from);
    const all = (text: string) =>
      [...twice.matchAll(new RegExp(text.replace(/[.[]/gu, '\\$&'), 'gu'))].map(
        ({ index }) => index ?? 0
      );
    const declared = all('@left[');
    // Two in the algorithm, the string skipped, then two in the listing, in that order.
    expect(declared).toHaveLength(5);
    expect(at('@rise.compare.left')).toEqual([
      declared[0],
      declared[3],
      twice.indexOf('@rise.compare.left)')
    ]);
    expect(at('@fall.compare.left')).toEqual([
      declared[2],
      declared[4],
      twice.indexOf('@fall.compare.left)')
    ]);
  });

  it('name a design variable by its kind and place', () => {
    expect(named('Highlight.Link.targetFill')).toEqual(['Highlight', '<Link']);
    expect(named('Highlight.Link:@compare.left.targetFill')).toEqual([
      'Highlight',
      '<Link',
      '{@compare.left}'
    ]);
    // Without a build, a value in braces has no type the text says; a place still names it.
    expect(named('views.Int')).toEqual([]);
    expect(named('views.Index:@compare.right')).toEqual(['{@compare.right}']);
  });

  it('name lines, a line and column, or a run of lines', () => {
    expect(named('line 12')).toEqual([
      '<View of="Index" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>'
    ]);
    expect(named('12:24')).toEqual([
      'Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>'
    ]);
    expect(named('lines 18-19')).toEqual(['    {@compare.left}\n    {@compare.right}']);
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

describe('view choices, by what a build records each render reads', () => {
  const both = `<View of="Index" name="IndexText"><Node value={this} /></View>
<View of="Index" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<View of="Index" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="At"><Node>at {@render Index(lo)}</Node></Layout>
<At />
{@render Index(mid)}
{@render Index(found)}`;
  /** A render's line:column (both from 1), as a build records it. */
  const siteOf = (written: string) => {
    const at = both.indexOf(written);
    const before = both.slice(0, at);
    return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
  };
  const design = {
    renders: {
      [siteOf('{@render Index(lo)}')]: 'views.Index',
      [siteOf('{@render Index(mid)}')]: 'views.Index',
      [siteOf('{@render Index(found)}')]: 'views.Index:found'
    },
    variant: {
      'views.Index': 'Highlight',
      'views.Index:found': 'Arrow'
    }
  };
  const covered = (text: string, built?: typeof design) =>
    referenceRanges(both, text, built).map(({ from, to }) => both.slice(from, to));

  it('name the renders reading them, and the view chosen', () => {
    expect(covered('views.Index', design)).toEqual([
      'Highlight',
      '{@render Index(lo)}',
      '{@render Index(mid)}'
    ]);
  });

  it('name the same with keys as written: {Index}, {Index}:found', () => {
    expect(covered('{Index}', design)).toEqual(covered('views.Index', design));
    expect(covered('{Index}:found', design)).toEqual(covered('views.Index:found', design));
    expect(
      codeIn(both, 'set {Index}:found and Highlight.Link:@compare.left.targetFill', design)
    ).toEqual([
      { text: 'set ', code: false },
      { text: '{Index}:found', code: true },
      { text: ' and ', code: false },
      { text: 'Highlight.Link:@compare.left.targetFill', code: true }
    ]);
  });

  it("name a place's own render, and leave it out of the type's once set apart", () => {
    expect(covered('views.Index:found', design)).toEqual(['Arrow', '{@render Index(found)}']);
    const alike = {
      ...design,
      variant: { ...design.variant, 'views.Index:found': 'Highlight' }
    };
    expect(covered('views.Index', alike)).toEqual([
      'Highlight',
      '{@render Index(lo)}',
      '{@render Index(mid)}',
      '{@render Index(found)}'
    ]);
  });

  it('name nothing a build records no render reading, and every render without a record', () => {
    expect(covered('views.Int', design)).toEqual([]);
    expect(covered('views.Index')).toEqual([
      '{@render Index(lo)}',
      '{@render Index(mid)}',
      '{@render Index(found)}'
    ]);
  });
});

describe('code in an error message', () => {
  const dotted = `<script listing="code">
  for i = 0 to n - 1
      @check[if A[i] == target:] @check.found[return i]
      @next[@found[return i]]
</script>
<script algorithm>let i = Index(1);</script>
<View of="Index" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>

<Layout name="Main">
  <Node>
    {@render Highlight(@left)}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main"><Main /></Scene>
</Storyboard>`;
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
    expect(named('Highlight(…)')).toEqual([]);
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
      { message: 'here', raw: 'here', severity: 'error', line: 18, column: 6 },
      {
        message: 'span',
        raw: 'span',
        severity: 'error',
        line: 12,
        column: 24,
        endLine: 12,
        endColumn: 33
      },
      { message: 'nowhere', raw: 'nowhere', severity: 'error', line: 99, column: 1 }
    ]);
    expect(ranges.map(({ from, to }) => source.slice(from, to))).toEqual([
      'Highlight',
      '@compare.left}'
    ]);
  });
});

describe('design variables with a row of their own', () => {
  const design = {
    variant: {
      'views.Index': 'IndexText',
      'views.Index:found': 'Arrow',
      'Highlight.Link.targetFill': 'amber-100',
      'Highlight.Link:@left.targetFill': 'sky-100',
      'IntCell.fill': 'white',
      'Main.gap': 0.5,
      '<Listing>.language': 'code'
    }
  };

  it("are a kind's or a place's prop, a place's view choice, or a frame or listing setting", () => {
    for (const key of [
      'Highlight.Link:@left.targetFill',
      'Highlight.Link.targetFill',
      'IntCell.fill',
      'views.Index:found',
      'Main.gap',
      '<Listing>.language'
    ])
      expect(ghostKey(` ${key} `, design)).toBe(key);
  });

  it("are not a type's own view choice, a key the variant has not, or anything without a build", () => {
    expect(ghostKey('views.Index', design)).toBeUndefined();
    expect(ghostKey('Highlight.Link:right.targetFill', design)).toBeUndefined();
    expect(ghostKey('@left', design)).toBeUndefined();
    expect(ghostKey('IntCell.fill')).toBeUndefined();
  });
});

describe('long label names in pills', () => {
  const shown = (text: string) => {
    const parts = elidedName(text);
    return parts ? `${parts.head}…${parts.tail}` : text;
  };

  it('keep the last two parts of a label, eliding those before', () => {
    expect(shown('@insert.compare.left')).toBe('@…compare.left');
    expect(shown('pause@insert.compare.left')).toBe('pause@…compare.left');
    expect(shown('@sweep.pair.swap.a')).toBe('@…swap.a');
    expect(elidedName('@insert.compare.left')).toEqual({
      head: '@',
      hidden: 'insert.',
      tail: 'compare.left'
    });
  });

  it("keep a kind's place's prop, and show names of two parts or fewer whole", () => {
    expect(shown('Highlight.Link:@insert.compare.left.targetFill')).toBe(
      'Highlight.Link:@…compare.left.targetFill'
    );
    expect(shown('views.Index:@search.check.at')).toBe('views.Index:@…check.at');
    for (const text of [
      '@swap.held',
      '@left',
      'pause@insert.swap',
      'Ask.IntCell:g.a.fill',
      'IntCell.fill'
    ])
      expect(elidedName(text)).toBeUndefined();
  });
});
