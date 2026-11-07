import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import { designOnlyWarning } from './padding-warnings.server';
import { repeatedStepWarnings } from './storyboard.server';
import { placeWarningCodes } from './place-checks.server';
import type { BuildWarning } from './warnings';

/** A build's warnings but those of its look only, as padding nobody sees, which these leave aside. */
// The scene's warnings: a look only, and the place and label checks (place-checks.server.ts), left out.
const unlooked = (warnings: readonly BuildWarning[] = []) =>
  warnings
    .filter(({ code }) => !placeWarningCodes.has(code))
    .map(({ message }) => message)
    .filter((warning) => !warning.endsWith(designOnlyWarning));

const blocks = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 7 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
  const target = Int;
</script><Case name="main" values={[2, 5, 7, 9, 12]} target={9} />

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
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Search">
  <Node>
    {values}
    {lo}
    {hi}
  </Node>
</Layout>
<Layout name="Card"><Node><Node>When the target is missing, lo passes hi.</Node></Node></Layout>
`;

const search = '<Search />';
const storyboard = (...scenes: string[]) =>
  `${blocks}\n<Storyboard>\n${scenes.join('\n')}\n</Storyboard>`;
// A scene showing state, any layout but the card, shows the case main, unless it names its own.
const scene = (props: string, shows = search) =>
  `  <Scene ${props}${shows !== '<Card />' && !/\bcase=/u.test(props) ? ' case="main"' : ''}>${shows}</Scene>`;

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
    expect(labels[0]).toBe('@case.start');
    expect(labels.some((label) => /^[\w-]+ ?.*: /u.test(label))).toBe(false);
    expect(one.design.space).not.toHaveProperty('layout');
  });

  it('plays scenes in order, each showing what it selects, whatever the one before showed', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(
        scene('name="search"'),
        scene('name="then"', '<Card />'),
        scene('name="probe" within="@probe#2" pause="@probe.pick.end" title="the second probe"')
      )
    );
    expect(prepared.storyboard.scenes.map(({ name, frame }) => [name, frame])).toEqual([
      ['search', false],
      ['then', true],
      ['probe', false]
    ]);
    const { labels, warnings } = await bundlePresentation(prepared, 1);
    const scenes = labels.map((label) => label.split(':')[0]);
    // The whole case, the card as one frame, then the second probe again from its :before.
    expect(labels[0]).toBe('search: @case.start');
    expect(scenes.indexOf('then')).toBe(scenes.lastIndexOf('then'));
    expect(
      scenes.slice(scenes.indexOf('then') + 1).every((name) => name === 'probe (the second probe)')
    ).toBe(true);
    // The second probe opens on its .start. Its pick sets only mid and its end, finding the
    // target, moves nothing, and the view reads neither: each draws what the step before drew, so
    // is left out, with a warning naming it.
    expect(labels.at(-1)).toBe('probe (the second probe): @probe#2.start');
    expect(warnings?.map(({ message }) => message)).toContain(
      'In the scene probe, @probe#2.start and @probe.pick#2.end draw the same picture, so @probe.pick#2.end is left out: pause at what changes the picture, or show what this step means with a node with when, as <Node when="@label">…</Node>.'
    );
    // Every presentation shows the source's steps.
    expect(labels).toEqual(prepared.steps);
  });

  it('shows one edge of a scene, its :before or its :after', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(scene('name="first" at="@case.start"'), scene('name="last" at="@case.end"'))
    );
    const { labels } = await bundlePresentation(prepared, 1);
    const whole = await bundlePresentation(
      prepareSvelteComponent(storyboard(scene('name="search"'))),
      1
    );
    expect(labels).toEqual(['first: @case.start', `last: ${whole.labels.at(-1)}`]);
    expect(problemOf(storyboard(scene('name="first" at="start"')))).toContain('at="@case.start"');
  });

  it('opens and closes each stepping scene on its .start and .end, its pauses between', async () => {
    const prepared = prepareSvelteComponent(
      storyboard(
        scene('name="whole"'),
        scene('name="first" within="@probe#1"'),
        scene('name="picks" within="@probe#1" pause="@probe.pick.end"'),
        scene('name="hit" within="@probe#2"')
      )
    );
    const { labels } = await bundlePresentation(prepared, 1);
    // No pause: the input as given and the end; within a run, just before it and just after it,
    // the run's own label adding no pause. A pick sets only mid, which the view does not read, and
    // the probe finding the target moves nothing drawn: each is left out, drawing what the step
    // before it drew.
    expect(labels).toEqual([
      'whole: @case.start',
      'whole: @case.end',
      'first: @probe#1.start',
      'first: @probe#1.end',
      'picks: @probe#1.start',
      'picks: @probe#1.end',
      'hit: @probe#2.start'
    ]);
  });

  it('pauses just before each span of a label at its .start, and at its end at .end', async () => {
    const labelsOf = async (pause: string) =>
      (
        await bundlePresentation(
          prepareSvelteComponent(storyboard(scene(`name="s" pause="${pause}"`))),
          1
        )
      ).labels;
    const both = await labelsOf('@probe.right.start, @probe.right.end');
    expect(both).toContain('@probe.right#1.start');
    expect(both).toContain('@probe.right#1.end');
    expect(both.indexOf('@probe.right#1.start')).toBeLessThan(both.indexOf('@probe.right#1.end'));
    // A label alone is a stretch, and a pause takes a moment.
    await expect(labelsOf('@probe.right')).rejects.toThrow('a label alone is a stretch');
    await expect(labelsOf('@probe.right:after')).rejects.toThrow('a label alone is a stretch');
    expect(
      (await labelsOf('@probe.right.start')).some((label) =>
        /^@probe\.right#\d+\.end$/u.test(label)
      )
    ).toBe(false);
  });

  it('paces a scene by its own pauses alone', async () => {
    const prepared = prepareSvelteComponent(storyboard(scene('name="probes" pause="@probe.end"')));
    const { labels } = await bundlePresentation(prepared, 1);
    expect(
      labels
        .filter((label) => label.startsWith('@') && !label.startsWith('@case.'))
        .every((label) => /^@probe#\d+\.end$/u.test(label))
    ).toBe(true);
  });

  it('keeps a layout’s placement in every scene showing it', async () => {
    const reserved = async (source: string) => {
      const { geometry } = await bundlePresentation(prepareSvelteComponent(source), 1);
      return Object.fromEntries(geometry.reserved);
    };
    const whole = await reserved(storyboard(scene('name="search"')));
    const both = await reserved(
      storyboard(
        scene('name="search"'),
        scene('name="probe" within="@probe#2" pause="@probe.pick.end"')
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
      'within="@probe#9" matches no span: in the case main, @probe has'
    ],
    [
      'a within written as another selector',
      storyboard(scene('name="probe" within="Run[label=probe]"')),
      'within="Run[label=probe]" names the spans of a label'
    ],
    [
      'a label that is none of the algorithm’s',
      storyboard(scene('name="probe" pause="@nothing.end"')),
      'The scene probe names @nothing, no label of the algorithm'
    ],
    [
      'pause on a single frame',
      storyboard(scene('name="then" pause="@probe.end"', '<Card />')),
      'The scene then shows Card, which reads no state, so it is one frame'
    ],
    [
      "props on a scene's layout",
      storyboard(scene('name="then"', '<Card lo={lo} />')),
      "The scene then passes Card props, and a layout's tag takes none"
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
      `${blocks}<Layout name="Both"><Node>${search}</Node></Layout>\n<Storyboard>\n${scene('name="a"')}\n${scene('name="b"', '<Both />')}\n</Storyboard>`,
      'Search is shown by a scene, so it arranges the whole page, and is drawn inside another layout too'
    ]
  ])('refuses %s', (_, source, message) => {
    expect(problemOf(source)).toContain(message);
  });
});

describe('cases', () => {
  // The blocks with the cases given in place of the one, main.
  const withCases = (cases: string, ...scenes: string[]) =>
    storyboard(...scenes).replace(/<Case name="main"[^\n]*\/>/u, cases);

  it('shows two cases, each scene paced from its own', async () => {
    const two = prepareSvelteComponent(
      withCases(
        '<Case name="present" values={[2, 5, 7, 9, 12]} target={9} />\n<Case name="absent" values={[2, 5, 7, 9, 12]} target={4} />',
        scene('name="found" case="present"'),
        scene('name="card"', '<Card />'),
        scene('name="missing" case="absent"')
      )
    );
    const { labels } = await bundlePresentation(two, 1);
    expect(labels[0]).toBe('found: @case.start');
    expect(labels).toContain('card');
    // The absent target takes three probes, the present one two.
    expect(labels.filter((label) => label.startsWith('missing: '))).toEqual([
      'missing: @case.start',
      'missing: @case.end'
    ]);
    expect(two.steps).toEqual(labels);
  });

  it.each([
    [
      'a stepping scene naming no case',
      storyboard('  <Scene name="search">' + search + '</Scene>'),
      'The scene search steps through a case, so it names it, as <Scene name="search" case="main">; the cases are main.'
    ],
    [
      'a scene naming a case no <Case> names',
      storyboard(scene('name="search" case="other"')),
      'The scene search shows the case other, and no case is named other; the cases are main.'
    ],
    [
      'a case missing an input',
      withCases('<Case name="main" values={[2, 5]} />', scene('name="search"')),
      'The case main gives no target: a case gives every input the input block declares, as target={…}.'
    ],
    [
      'a case giving an input the input block does not declare',
      withCases(
        '<Case name="main" values={[2, 5]} target={5} extra={1} />',
        scene('name="search"')
      ),
      'The case main gives extra, which the input block does not declare; its inputs are values, target.'
    ],
    [
      'a value not of its input’s type',
      withCases('<Case name="main" values={[2, 500]} target={5} />', scene('name="search"')),
      'In the case main, values: '
    ],
    [
      'two cases of one name',
      withCases(
        '<Case name="main" values={[2]} target={2} />\n<Case name="main" values={[3]} target={3} />',
        scene('name="search"')
      ),
      'Two cases are named main'
    ],
    [
      'a value in the input block',
      storyboard(scene('name="search"')).replace('const target = Int;', 'const target = Int(9);'),
      'target is given a value in the input block, which declares only its type: write const target = Int;'
    ],
    [
      'a type name in a case value',
      withCases('<Case name="main" values={[2, 5]} target={Int(5)} />', scene('name="search"')),
      'The value of target names the type Int: a case writes each value plainly, as target={9} or target={[2, 5, 7]}'
    ],
    [
      'a <Run>',
      withCases('<Run name="main" values={[2, 5]} target={5} />', scene('name="search"')),
      'An execution the source shows is a <Case>, not a <Run>'
    ],
    [
      'a scene naming its case with run',
      storyboard('  <Scene name="search" run="main">' + search + '</Scene>'),
      'A <Scene> names the execution it shows with case, as case="present"'
    ],
    [
      'a case on a single frame',
      storyboard(scene('name="search"'), '  <Scene name="card" case="main"><Card /></Scene>'),
      'The scene card shows Card, which reads no state, so it is one frame'
    ]
  ])('refuses %s', (_, source, message) => {
    expect(problemOf(source)).toContain(message);
  });
});

describe('steps drawing the same picture', () => {
  /** A linear search for 7 in [4, 9, 2, 7], its view reading i and values, with `layout` added. */
  const linear = (pause: string, layout = '') => `<script domain>
  const Int = type('integer', { min: 0, max: 20 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const target = Int;
</script>
<script algorithm>
  @start[let i = Index(values, 0);]
  while (@compare[values[i] !== target]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Scan">
  <Node>
    <Node>{#each values as v}{v}{/each}</Node>
    ${layout}
    {i}
  </Node>
</Layout>
<Case name="main" values={[4, 9, 2, 7]} target={7} />
<Storyboard>
  <Scene name="scan" case="main" pause="${pause}"><Scan /></Scene>
</Storyboard>`;

  it("leaves out the scene's @case.end where it draws what the last pause drew, unwarned, as no pause chose it", async () => {
    const { labels, warnings } = await bundlePresentation(
      prepareSvelteComponent(linear('@compare.end')),
      1
    );
    expect(labels).toEqual([
      '@case.start',
      '@compare#1.end',
      '@compare#2.end',
      '@compare#3.end',
      '@compare#4.end'
    ]);
    expect(unlooked(warnings)).toEqual([]);
  });

  it('leaves out a paused step drawing exactly what the step before drew, with a warning naming both', async () => {
    const { labels, warnings } = await bundlePresentation(
      prepareSvelteComponent(linear('@start.end, @compare.start')),
      1
    );
    expect(labels).toEqual([
      '@case.start',
      '@start#1.end',
      '@compare#2.start',
      '@compare#3.start',
      '@compare#4.start'
    ]);
    expect(unlooked(warnings)).toEqual([
      '@start#1.end and @compare#1.start draw the same picture, so @compare#1.start is left out: pause at what changes the picture, or show what this step means with a node with when, as <Node when="@label">…</Node>.'
    ]);
  });

  it('keeps the end where a node with when="@case.end" draws something new there, one at each step', async () => {
    const oneOf =
      '<Node layout="stack"><Node when="@compare">checking</Node><Node when="@case.end">done</Node></Node>';
    const prepared = prepareSvelteComponent(
      linear('@compare.end', oneOf).replace('of="values, i"', 'of="values, i, @compare"')
    );
    const { labels, warnings } = await bundlePresentation(prepared, 1);
    expect(labels.slice(-2)).toEqual(['@compare#4.end', '@case.end']);
    expect(unlooked(warnings)).toEqual([]);
  });

  /** A linear search over records drawn by `item`, its pointer at the element searched. */
  const records = (item: string, views = '') => `<script domain>
  const Int = type('integer', { min: 0, max: 20 });
  const Item = record({ value: Int });
  const Items = array(Item, { max: 5 });
  const Index = index(Items);
</script>
<script input>
  const items = Items;
  const target = Int;
</script>
<script algorithm>
  @start[let i = Index(items, 0);]
  while (@compare[items[i].value !== target]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
${views}
<Layout name="Scan">
  <Node>
    <Node>{#each items as item}${item}{/each}</Node>
    {i}
  </Node>
</Layout>
<Case name="main" items={[{ value: 4 }, { value: 9 }, { value: 2 }, { value: 7 }]} target={7} />
<Storyboard>
  <Scene name="scan" case="main" pause="@next.end"><Scan /></Scene>
</Storyboard>`;

  it('warns of the paused steps a link reaching nothing leaves alike, its elements drawn only by their fields', async () => {
    const built = await bundlePresentation(prepareSvelteComponent(records('{item.value}')), 1);
    // Each step moves i, which the view reads, so none is left out; but none shows it.
    expect(built.labels).toEqual(['@case.start', '@next#1.end', '@next#2.end', '@next#3.end']);
    expect(unlooked(built.warnings)).toEqual([
      '2 steps at @next draw the same picture as the step before them, as @next#1.end to @next#3.end: what changes there shows nowhere in the view. Pause at what changes the picture, or draw what changes, as a value or a pointer at an element the view draws.'
    ]);
    const marked = await bundlePresentation(
      prepareSvelteComponent(
        records('{item}', '<View of="Item" name="ItemCell"><Node value={this.value} /></View>')
      ),
      1
    );
    expect(unlooked(marked.warnings)).toEqual([]);
  });

  it('warns of a pause on a label marking only the value a declaration gives, the view drawing the name', async () => {
    const search = (algorithm: string, pause: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 20 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  ${algorithm}
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Scan">
  <Node>
    <Node>{#each values as v}{v}{/each}</Node>
    {mid}
  </Node>
</Layout>
<Case name="main" values={[4, 9, 2, 7]} />
<Storyboard>
  <Scene name="scan" case="main" pause="${pause}"><Scan /></Scene>
</Storyboard>`;
    const value = '@probe[const mid = @mid[Index(Math.floor(values.length / 2))];]';
    const before = await bundlePresentation(
      prepareSvelteComponent(search(value, '@probe.mid.end')),
      1
    );
    expect(before.warnings?.map(({ message }) => message)).toContain(
      '@probe.mid wraps only the value given to mid, so a scene pausing there pauses after the value is worked out but before mid holds it: mid does not exist at that step, and nothing drawing it shows. Label the whole statement, as @mid[const mid = …;].'
    );
    const whole = await bundlePresentation(
      prepareSvelteComponent(
        search('@mid[const mid = Index(Math.floor(values.length / 2));]', '@mid.end')
      ),
      1
    );
    expect((whole.warnings ?? []).map(({ message }) => message)).not.toContainEqual(
      expect.stringContaining('wraps only the value')
    );
  });

  it('tells one repeat by both steps, each label once, within a scene, and at most five labels', () => {
    const scene = (name: string) => ({ name, layout: 'Main', frame: false, start: 0 });
    const [first, second] = [scene('first'), scene('second')];
    const step = (on: typeof first, name: string, drawn: string) => ({ scene: on, name, drawn });
    const hint =
      ': what changes there shows nowhere in the view. Pause at what changes the picture, or draw what changes, as a value or a pointer at an element the view draws.';
    expect(
      repeatedStepWarnings(
        [
          step(first, '@case.start', 'a'),
          step(first, '@pick#1.end', 'b'),
          step(first, '@pick#2.end', 'b'),
          // A scene opens on its own first step, whatever the one before drew.
          step(second, '@pick#3.end', 'b'),
          step(second, '@case.end', 'b')
        ],
        2
      )
    ).toEqual([`In the scene first, @pick#2.end draws the same picture as @pick#1.end${hint}`]);
    const labels = ['@a', '@b', '@c', '@d', '@e', '@f', '@g'];
    expect(
      repeatedStepWarnings(
        labels.flatMap((label) => [
          step(first, `${label}#1.end`, label),
          step(first, `${label}#2.end`, label)
        ]),
        1
      ).at(-1)
    ).toBe('Steps at 2 more labels draw the same picture as the step before them.');
  });
});
