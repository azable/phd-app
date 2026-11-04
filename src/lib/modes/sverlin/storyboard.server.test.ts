import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';

const blocks = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 7 });
  const Index = index(Values);
</script>

<script input>
  const values = Values([2, 5, 7, 9, 12]);
  const target = Int(9);
</script>

<script algorithm>
  @bounds[let lo = Index(0); let hi = values.length - 1;]
  while (@open[lo <= hi]) @probe{
    @pick[const mid = Index(Math.floor((lo + hi) / 2));]
    @check[if (@hit[values[mid] === target]) break;]
    if (@low[values[mid] < target]) @right[lo = mid + 1;]
    else @left[hi = mid - 1;]
  }
</script>

<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Mark"><Pointed /></View>
<Layout name="Search" of="values, lo, hi">
  <Node>
    {values}
    {lo}
    {hi}
  </Node>
</Layout>
<Layout name="Card"><Node><Node>When the target is missing, lo passes hi.</Node></Node></Layout>
`;

const search = '<Search values={values} lo={lo} hi={hi} />';
const storyboard = (...scenes: string[]) =>
  `${blocks}\n<Storyboard>\n${scenes.join('\n')}\n</Storyboard>`;
const scene = (props: string, shows = search) => `  <Scene ${props}>${shows}</Scene>`;

const problemOf = (source: string) => {
  try {
    prepareSvelteComponent(source);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('storyboards', () => {
  it('keeps the steps’ own names for one scene', async () => {
    const one = prepareSvelteComponent(storyboard(scene('name="search"')));
    const { labels } = await bundlePresentation(one, 1);
    expect(labels[0]).toBe(':before');
    expect(labels.some((label) => /^[\w-]+ ?.*: /u.test(label))).toBe(false);
    expect(one.design.space).not.toHaveProperty('layout');
  });

  it('plays scenes in order, each showing what it selects, whatever the one before showed', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(
        scene('name="search"'),
        scene('name="then"', '<Card />'),
        scene('name="probe" within="@probe#2" pause="@probe.pick" title="the second probe"')
      )
    );
    expect(prepared.storyboard.scenes.map(({ name, frame }) => [name, frame])).toEqual([
      ['search', false],
      ['then', true],
      ['probe', false]
    ]);
    const { labels } = await bundlePresentation(prepared, 1);
    const scenes = labels.map((label) => label.split(':')[0]);
    // The whole run, the card as one frame, then the second probe again from its :before.
    expect(labels[0]).toBe('search: :before');
    expect(scenes.indexOf('then')).toBe(scenes.lastIndexOf('then'));
    expect(
      scenes.slice(scenes.indexOf('then') + 1).every((name) => name === 'probe (the second probe)')
    ).toBe(true);
    // The second probe opens on its :before and closes on its :after, its pick between.
    expect(labels.slice(-3)).toEqual([
      'probe (the second probe): @probe#2:before',
      'probe (the second probe): @probe.pick#2',
      'probe (the second probe): @probe#2'
    ]);
    // Every presentation shows the source's steps.
    expect(labels).toEqual(prepared.steps);
  });

  it('shows one edge of a scene, its :before or its :after', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(scene('name="first" at=":before"'), scene('name="last" at=":after"'))
    );
    const { labels } = await bundlePresentation(prepared, 1);
    const whole = await bundlePresentation(
      prepareSvelteComponent(storyboard(scene('name="search"'))),
      1
    );
    expect(labels).toEqual(['first: :before', `last: ${whole.labels.at(-1)}`]);
    expect(problemOf(storyboard(scene('name="first" at="start"')))).toContain('at=":before"');
  });

  it('opens and closes each stepping scene on its :before and :after, its pauses between', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(
        scene('name="whole"'),
        scene('name="first" within="@probe#1"'),
        scene('name="picks" within="@probe#1" pause="@probe.pick"'),
        scene('name="hit" within="@probe#2"')
      )
    );
    const { labels } = await bundlePresentation(prepared, 1);
    // No pause: the input as given and the end; within a run, just before it and just after it,
    // the run's own label adding no pause. The probe finding the target moves nothing drawn, so
    // its :after, drawing what its :before drew, is left out.
    expect(labels).toEqual([
      'whole: :before',
      'whole: :after',
      'first: @probe#1:before',
      'first: @probe#1',
      'picks: @probe#1:before',
      'picks: @probe.pick#1',
      'picks: @probe#1',
      'hit: @probe#2:before'
    ]);
  });

  it('pauses just before each run of a label at its :before, and at its end at :after', async () => {
    const labelsOf = async (pause: string) =>
      (
        await bundlePresentation(
          prepareSvelteComponent(storyboard(scene(`name="s" pause="${pause}"`))),
          1
        )
      ).labels;
    const both = await labelsOf('@probe.right:before, @probe.right');
    expect(both).toContain('@probe.right#1:before');
    expect(both).toContain('@probe.right#1');
    expect(both.indexOf('@probe.right#1:before')).toBeLessThan(both.indexOf('@probe.right#1'));
    expect(await labelsOf('@probe.right:after')).toEqual(await labelsOf('@probe.right'));
    expect(
      (await labelsOf('@probe.right:before')).some((label) => /^@probe\.right#\d+$/u.test(label))
    ).toBe(false);
  });

  it('paces a scene by its own pauses alone', async () => {
    const prepared = prepareSvelteComponent(storyboard(scene('name="probes" pause="@probe"')));
    const { labels } = await bundlePresentation(prepared, 1);
    expect(
      labels.filter((label) => label.startsWith('@')).every((label) => /^@probe#\d+$/u.test(label))
    ).toBe(true);
  });

  it('keeps a layout’s placement in every scene showing it', async () => {
    const reserved = async (source: string) => {
      const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1);
      const [geometry] = JSON.parse(/window\.__sverlinGeometry=(.*);\n/u.exec(javascript)![1]);
      return Object.fromEntries(geometry.reserved);
    };
    const whole = await reserved(storyboard(scene('name="search"')));
    const both = await reserved(
      storyboard(
        scene('name="search"'),
        scene('name="probe" within="@probe#2" pause="@probe.pick"')
      )
    );
    expect(both).toEqual(whole);
  });

  it.each([
    ['a source with none', blocks, 'The view has no storyboard'],
    [
      'a scene showing a layout not declared',
      storyboard(scene('name="search"', '<Board />')),
      'The scene search shows <Board />, and no layout is named Board'
    ],
    [
      'a scene showing nothing',
      storyboard('  <Scene name="search"></Scene>'),
      'The scene search shows nothing'
    ],
    [
      'a scene showing two layouts',
      storyboard(scene('name="search"', `${search}<Card />`)),
      'A scene nests exactly one layout'
    ],
    [
      'a within matching no run',
      storyboard(scene('name="probe" within="@probe#9"')),
      'within="@probe#9" matches no run: @probe runs'
    ],
    [
      'a within written as another selector',
      storyboard(scene('name="probe" within="Run[label=probe]"')),
      'within="Run[label=probe]" names the runs of a label'
    ],
    [
      'a label that is none of the algorithm’s',
      storyboard(scene('name="probe" pause="@nothing"')),
      'The scene probe names @nothing, no label of the algorithm'
    ],
    [
      'pause on a single frame',
      storyboard(scene('name="then" pause="@probe"', '<Card />')),
      'The scene then shows Card, which reads no state, so it is one frame'
    ],
    [
      'state passed to a single frame',
      storyboard(scene('name="then"', '<Card lo={lo} />')),
      'The scene then passes lo to Card, which reads no state'
    ],
    [
      'an input not passed',
      storyboard(scene('name="search"', '<Search values={values} lo={lo} />')),
      '<Search> declares hi among its inputs, and the scene search passes none'
    ],
    [
      'two scenes of one name',
      storyboard(scene('name="search"'), scene('name="search"')),
      'Two scenes are named search'
    ],
    [
      'a computed prop',
      storyboard(scene('name="search" at={moment}')),
      "A <Scene>'s at is written as it is, not computed"
    ],
    [
      'a layout shown by a scene and drawn by another',
      `${blocks}<Layout name="Both" of="values, lo, hi"><Node>${search}</Node></Layout>\n<Storyboard>\n${scene('name="a"')}\n${scene('name="b"', '<Both values={values} lo={lo} hi={hi} />')}\n</Storyboard>`,
      'Search is shown by a scene, so it arranges the whole page, and is drawn inside another layout too'
    ]
  ])('refuses %s', (_, source, message) => {
    expect(problemOf(source)).toContain(message);
  });
});
