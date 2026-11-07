import { describe, expect, it } from 'vitest';

import {
  captionNames,
  clumpedLabels,
  literalValues,
  plainCode,
  plainListingVariables,
  unmarkedListingChanges,
  unmarkedListingLines,
  unpausedLabels
} from './place-checks.server';
import { drawnSteps } from './testing/scenes';

const drawn = '<Layout name="Show"><Node>{i} {target} {values}</Node></Layout>';
const source = (listing: string, algorithm: string, markup = '', pause = '@scan.check') => `
<script input>
  const values = Values;
  const target = Int;
</script>

<script algorithm>
${algorithm}
</script>

<script listing="textbook">
${listing}
</script>

${markup}
${drawn}

<Storyboard>
  <Scene name="search" case="main" pause="${pause}"><Main /></Scene>
</Storyboard>`;

const search = `  @start[let i = Index(values, 0);]
  for (; @more[i < values.length]; @next[i++]) @scan{
    if (@check[values[i] === target]) @found{
      return;
    }
  }`;

const codes = (warnings: { code: string }[]) => warnings.map(({ code }) => code);

describe('place and label checks', () => {
  it('asks for a token where a listing writes a variable as plain text, past its heading', () => {
    const warnings = plainListingVariables(
      source(
        `SEARCH(A, target)
1  @start[start at i = 0]
2  @scan.check[if A[:i[i]] = :target[target]]
3  @next[i = i + 1]`,
        search
      )
    );
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'listing.plain-variable',
        message: expect.stringContaining('writes i as plain text on lines 2, 4')
      })
    ]);
    // A variable no render draws has no place a token could name, so the build would refuse one.
    expect(
      plainListingVariables(
        source('SEARCH(A)\n1  @start[start at i = 0]', search).replace(drawn, '')
      )
    ).toEqual([]);
  });

  it('asks for a token of a changed variable its region marks by no name', () => {
    const warnings = unmarkedListingChanges(
      source(`SEARCH(A)\n1  @start[begin]\n2  @next[step :i[j] on]`, search)
    );
    expect(warnings.map(({ message }) => message)).toEqual([
      expect.stringContaining('region @start changes i')
    ]);
  });

  it('finds a listing line no region marks between marked lines', () => {
    const warnings = unmarkedListingLines(
      source(`SEARCH(A)\n1  @start[begin]\n2  nothing here\n3  @next[go on]`, search)
    );
    expect(warnings[0]).toMatchObject({
      code: 'listing.line-without-region',
      message: expect.stringContaining('line 3')
    });
  });

  it('finds a caption naming a variable, code written as words, and a value written as text', () => {
    const markup = `<Layout name="Main"><Node layout="column">
  <Node kind="Caption">i</Node>
  <Node>Is values[i] > target?</Node>
  <Node>i is 3</Node>
  <Node kind="Caption">{place()}</Node>
  <Node>Is :i[values[i]] > {target}?</Node>
</Node></Layout>`;
    const written = source('SEARCH(A)\n1  @start[begin]', search, markup);
    expect(codes(captionNames(written))).toEqual(['view.caption-name']);
    expect(plainCode(written).map(({ message }) => message)).toEqual([
      expect.stringContaining('values[i]')
    ]);
    expect(codes(literalValues(written))).toEqual(['view.literal-value']);
  });

  it('finds a label a view shows by that no scene pauses at, nor any label inside it', () => {
    const markup = `<Layout name="Main"><Node layout="stack">
  <Node when="@found">Found</Node>
  <Node when="@scan">Looking</Node>
  {@scan.check}
</Node></Layout>`;
    expect(
      unpausedLabels(source('SEARCH(A)\n1  @start[begin]', search, markup)).map(
        ({ message }) => message
      )
    ).toEqual([expect.stringContaining('@found')]);
  });

  it('warns of two unlabelled statements in a label and of a listing region over unmarked lines', () => {
    const algorithm = `  for (let j = Index(values, 0); @more[j < values.length - 1]; @next[j++]) @pair{
    if (@test[values[j] > values[j + 1]]) @swap{
      const moved = values[j];
      values[j] = values[j + 1];
      values[j + 1] = moved;
    }
  }`;
    const listing = `SWAPS(A)
1  @pair.swap[swap A[j] and A[j + 1]:
2      save A[j]
3      move A[j + 1] down]`;
    const warnings = clumpedLabels(source(listing, algorithm, '', '@pair.swap'));
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'label.clumped',
        message: expect.stringContaining('@pair.swap holds 3 statements, 3 with no label')
      }),
      expect.objectContaining({
        code: 'label.clumped',
        message: expect.stringContaining('region @pair.swap spans 3 lines')
      })
    ]);
    const nested = algorithm.replace(
      /@swap\{[\s\S]*?\n {4}\}/u,
      `@swap{
      @save[const moved = values[j];]
      @move[values[j] = values[j + 1];]
      @put[values[j + 1] = moved;]
    }`
    );
    expect(clumpedLabels(source('SWAPS(A)\n1  @pair.swap[swap]', nested))).toEqual([]);
  });

  it('gives a clumped label as a coded warning of the built presentation', async () => {
    const { built } = await drawnSteps(`<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  @first[let a = Index(values, 0); let b = Index(values, 1);]
</script>

<View of="Int" name="Cell"><Node value={this} /></View>

<Layout name="Main"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout>

<Case name="main" values={[1, 2, 3]} />

<Storyboard>
  <Scene name="main" case="main" pause="@first.end"><Main /></Scene>
</Storyboard>`);
    expect(built.warnings).toContainEqual({
      code: 'label.clumped',
      message: expect.stringContaining('@first holds 2 statements')
    });
  });
});
