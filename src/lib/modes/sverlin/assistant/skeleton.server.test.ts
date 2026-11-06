import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from '../compile.server';
import { bundlePresentation } from '../testing/scenes';
import {
  fillSkeleton,
  holeGroups,
  holesOf,
  representationFamilies,
  representationSkeleton,
  skeletonFor
} from './skeleton.server';

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  @look[values.length;]
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>

<Layout name="Main" of="values">
  <Node layout="row">{#each values as v}{v}{/each}</Node>
</Layout>

<Case name="main" values={[3, 1, 2]} />
<Storyboard>
  <Scene name="look" case="main"><Main /></Scene>
</Storyboard>`;

const layout = `<Layout name="Main" of="values">
  <Node layout="column">{#each values as v}{v}{/each}</Node>
</Layout>`;

describe('skeletons', () => {
  it('puts one hole of any kind over the views and layouts for a whole-picture round', () => {
    const skeleton = representationSkeleton(source, 'show the values as bars');
    expect(skeleton).toBeDefined();
    const parsed = holesOf(skeleton!);
    if ('problems' in parsed) throw new Error(parsed.problems.join(' '));
    expect(parsed.holes).toMatchObject([
      { name: 'picture', kind: 'any', task: 'show the values as bars' }
    ]);
    expect(skeleton).not.toMatch(/<View\b|<Layout\b/u);
    expect(skeleton).toContain('<Case name="main"');
    // Filled with what it replaced, it is the source again, and builds.
    const region = source.slice(source.indexOf('<View'), source.lastIndexOf('</Layout>') + 9);
    const filled = fillSkeleton(skeleton!, { picture: region });
    expect(filled).toEqual({ source });
  });

  it('makes no whole-picture skeleton where a case lies among the views, or none is written', () => {
    const mixed = source.replace('<Layout name="Main"', '<Case name="x" />\n<Layout name="Main"');
    expect(representationSkeleton(mixed)).toBeUndefined();
    expect(representationSkeleton('<script algorithm></script>')).toBeUndefined();
  });

  it('reads holes, each its own group unless it shares one', () => {
    const parsed = holesOf(
      `<Hole name="page" kind="layout" task="wide" group="graph" />\n<Hole name="input" kind="case" task="a cycle" group="graph" />\n<Hole name="look" kind="view" of="Int" task="bars" />`
    );
    if ('problems' in parsed) throw new Error(parsed.problems.join(' '));
    expect(parsed.holes.map(({ name, kind, group }) => [name, kind, group])).toEqual([
      ['page', 'layout', 'graph'],
      ['input', 'case', 'graph'],
      ['look', 'view', 'look']
    ]);
    expect(holeGroups(parsed.holes).map((group) => group.map(({ name }) => name))).toEqual([
      ['page', 'input'],
      ['look']
    ]);
  });

  it('refuses holes of no kind, unnamed or twice named, and a skeleton with none', () => {
    expect(holesOf('<Hole name="a" kind="picture" task="" />')).toEqual({
      problems: [expect.stringContaining('kind=')]
    });
    expect(holesOf('<Hole kind="view" />')).toEqual({
      problems: [expect.stringContaining('needs a name')]
    });
    expect(holesOf('<Hole name="a" kind="view" /><Hole name="a" kind="case" />')).toEqual({
      problems: ['Two holes are named a.']
    });
    expect(holesOf(source)).toEqual({ problems: [expect.stringContaining('no <Hole')] });
  });

  it('puts each fill in its hole, so the rest of the source is the skeleton’s', () => {
    const made = skeletonFor(source, { layout: 'Main', task: 'the values in a column' });
    expect(made?.originals.layout).toContain('layout="row"');
    expect(made?.skeleton).toContain('task="the values in a column"');
    expect(fillSkeleton(made!.skeleton, { layout })).toEqual({
      source: source.replace(made!.originals.layout, layout)
    });
  });

  it('refuses a fill not of its hole’s kind, a missing fill, and a fill for no hole', () => {
    const { skeleton } = skeletonFor(source, { type: 'Int' })!;
    expect(fillSkeleton(skeleton, { view: layout })).toEqual({
      problems: [expect.stringContaining('one <View>')]
    });
    expect(fillSkeleton(skeleton, { view: '<View of="Values" name="X"><Node /></View>' })).toEqual({
      problems: [expect.stringContaining('a view of Int')]
    });
    expect(fillSkeleton(skeleton, {})).toEqual({ problems: ['The hole view has no fill.'] });
    expect(
      fillSkeleton(skeleton, {
        view: '<View of="Int" name="Bar"><Node value={this} /></View>',
        extra: '<Case name="b" values={[1]} />'
      })
    ).toEqual({ problems: ['The skeleton has no hole named extra.'] });
  });

  it('checks cases and the algorithm by their tags', () => {
    const skeleton = source
      .replace(
        '<Case name="main" values={[3, 1, 2]} />',
        '<Hole name="input" kind="case" task="" />'
      )
      .replace(
        /<script algorithm>[\s\S]*?<\/script>/u,
        '<Hole name="code" kind="algorithm" task="" />'
      );
    const filled = fillSkeleton(skeleton, {
      input: '<Case name="main" values={[2, 2]} />\n<Case name="other" values={[1]} />',
      code: '<script algorithm>\n  @look[values.length;]\n</script>'
    });
    expect(filled).toHaveProperty('source');
    expect(fillSkeleton(skeleton, { input: 'values = [1]', code: 'values.length' })).toEqual({
      problems: [
        expect.stringContaining('<script algorithm>'),
        expect.stringContaining('<Case … />')
      ]
    });
  });

  it('never builds a source that still has a hole', async () => {
    const { skeleton } = skeletonFor(source, { type: 'Int' })!;
    await expect(async () =>
      bundlePresentation(prepareSvelteComponent(skeleton), 1, {})
    ).rejects.toThrow();
  });
});

describe('whole-picture families', () => {
  const domain = (body: string) => `<script domain>\n${body}\n</script>`;

  it('gives each helper a different representation fitting what the domain holds', () => {
    const array = representationFamilies(source);
    const linked = representationFamilies(
      domain("const Node = record({ name: type('text') });\nconst Next = ref(Node);")
    );
    const plain = representationFamilies(domain("const Int = type('integer');"));
    for (const families of [array, linked, plain])
      expect(new Set(families).size).toBe(families.length);
    expect(array[0]).toMatch(/row of cells/);
    expect(array[1]).toMatch(/bars/);
    expect(linked[0]).toMatch(/node-and-arrow/);
    expect(plain.some((family) => /trace table/.test(family))).toBe(true);
  });
});
