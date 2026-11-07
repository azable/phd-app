import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';

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
<View of="Index" name="IndexText"><Node value={this} /></View>
`;

const target = '<Layout name="Target"><Node>{target}</Node></Layout>\n';
const main = (body: string) =>
  `<Layout name="Main">\n  <Node>\n    ${body}\n    {values}\n    {lo}\n    {hi}\n  </Node>\n</Layout>\n<Storyboard><Scene name="main" case="main"><Main /></Scene></Storyboard>`;

const problemOf = (view: string) => {
  try {
    prepareSvelteComponent(`${blocks}${view}`);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('layouts', () => {
  it('draws a layout by its tag, inline in a line of text as a value is', () => {
    const prepared = prepareSvelteComponent(
      `${blocks}${target}${main('<Target /><Node>Searching for <Target /> in the list</Node>')}`
    );
    expect(prepared.design.space).toHaveProperty('Target.fill');
    expect(Object.keys(prepared.design.space)).not.toContain('Main.Target.fill');
  });

  it('reads labels without listing them, its own and those of the layouts it draws', () => {
    // Quicksort's first source in benchmark run 4 read @partition.less in a <When> of its root
    // layout, unlisted, and was refused; labels are the whole algorithm's.
    const asked =
      '<Layout name="Asked"><Node when="@probe.check"><Node>checking</Node></Node></Layout>\n';
    expect(
      problemOf(`${asked}${main('<Asked /><Node when="@probe.right"><Node>right</Node></Node>')}`)
    ).toBe('');
    const prepared = prepareSvelteComponent(`${blocks}${asked}${main('<Asked />')}`);
    expect(prepared.storyboard.scenes[0].layout).toBe('Main');
  });

  it('reads the variables its body names, a tag or scene passing none of them', () => {
    expect(problemOf(`${target}${main('<Target />')}`)).toBe('');
  });

  it('names a misspelt variable in a layout', () => {
    const misspelt =
      '<Layout name="Main"><Node>{values}{taget}</Node></Layout>\n<Storyboard><Scene name="main" case="main"><Main /></Scene></Storyboard>';
    expect(problemOf(misspelt)).toContain(
      'The view reads taget, which is no variable or label of the algorithm'
    );
  });

  it('takes a label declared by a shorter one around it', () => {
    const reading =
      '<Layout name="Asked"><Node when="@probe.check">checking</Node></Layout>\n' +
      main('<Asked />');
    expect(problemOf(reading)).toBe('');
  });

  it.each([
    [
      'a tag passing props',
      `${target}${main('<Target target={target} />')}`,
      "<Target target={target} /> passes props, and a layout's tag takes none: the layout reads the state its body names, so draw it by its bare tag, <Target />."
    ],
    [
      'a scene passing props',
      main('').replace('<Main />', '<Main values={values} />'),
      "The scene main passes Main props, and a layout's tag takes none"
    ],
    [
      'an of',
      `<Layout name="Shown" of="values"><Node>{values}</Node></Layout>\n${main('<Shown />')}`,
      'A <Layout> takes no of: it reads the variables and labels its body names, so write <Layout name="Shown">.'
    ],
    [
      'a tag left open',
      `${target}${main('<Target></Target>')}`,
      "<Target> holds nothing: a layout's tag draws the layout, so close it at once, as <Target />."
    ],
    [
      'a layout drawn inside itself',
      `<Layout name="A"><Node><B /></Node></Layout>\n<Layout name="B"><Node><A /></Node></Layout>\n${main('<A />')}`,
      'a layout drawn inside itself would draw without end'
    ],
    [
      'a tag in a view',
      `<View of="Int" name="Labelled"><Node><Target /></Node></View>\n${target}${main('')}`,
      "<Target … /> draws a layout, which reads the algorithm's state, and a view reads only its value"
    ],
    [
      'two layouts of one name',
      `${target}${target}${main('<Target />')}`,
      'Two layouts are named Target'
    ],
    [
      'a prop other than name',
      `<Layout name="Shown" kind="X"><Node>shown</Node></Layout>\n${main('')}`,
      'A <Layout> takes only name'
    ],
    [
      'a name computed',
      `<Layout name={shown}><Node>shown</Node></Layout>\n${main('')}`,
      'is written as it is, not computed'
    ]
  ])('refuses %s', (_, view, message) => {
    expect(problemOf(view)).toContain(message);
  });
});

describe('nodes shown at a label', () => {
  it("shows a node with when at its label's steps, as <When> does", async () => {
    const shown = prepareSvelteComponent(
      `${blocks}${main('<Node when="@probe.check">checking</Node>')}`
    );
    const wrapped = prepareSvelteComponent(
      `${blocks}${main('<Node when="@probe.check"><Node>checking</Node></Node>')}`
    );
    expect(Object.keys(shown.design.space)).toEqual(Object.keys(wrapped.design.space));
  });

  it('takes turns in one place with a stack of nodes with when, and still reads <Node layout="stack">', () => {
    expect(
      problemOf(
        main(
          '<Node layout="stack"><Node when="@probe.right">right</Node><Node when="@probe.left">left</Node></Node>'
        )
      )
    ).toBe('');
    expect(
      problemOf(
        main(
          '<Node layout="stack"><Node when="@probe.right"><Node>right</Node></Node><Node when="@probe.left"><Node>left</Node></Node></Node>'
        )
      )
    ).toBe('');
  });

  it('refuses a when worked out from the state', () => {
    expect(problemOf(main('<Node when={lo < hi}>open</Node>'))).toContain(
      'when takes a label or a stop of the case, written as text'
    );
  });
});

describe('snippets', () => {
  it.each([
    [
      'a snippet taking a value',
      '{#snippet Shown(v: Int)}<Node>{v}</Node>{/snippet}',
      'Shown takes a value, as only a view does: write it as a view, <View of="Int" name="Shown">…</View>, its value this.'
    ],
    [
      'a snippet in a view',
      '<View of="Int" name="Tallied"><Node>{#snippet Tally()}<Node>•</Node>{/snippet}</Node></View>',
      '{#snippet Tally()} gives the nodes inside it a kind of their own: write kind="Tally" on the node instead, as <Node kind="Tally">…</Node>, where it is drawn.'
    ],
    [
      'a snippet at the top level',
      '{#snippet Title()}<Node>Binary search</Node>{/snippet}',
      '{#snippet Title()} is written as a layout: <Layout name="Title">…</Layout>, drawn where it is wanted by its bare tag, <Title />.'
    ],
    [
      'a render of a value',
      main('<Node>{@render Cell(target)}</Node>'),
      "{@render Cell(target)} is written {target}: a value in braces draws its type's view."
    ],
    [
      'a render of a layout',
      `${target}${main('{@render Target()}')}`,
      "{@render Target()} is written as the layout's bare tag, <Target />."
    ],
    [
      'a render worked out as the view runs',
      main('{@render (lo < hi ? A : B)()}'),
      'A layout is drawn by its tag where it is written, as <Title />'
    ]
  ])('refuses %s, naming the form that replaces it', (_, view, message) => {
    expect(problemOf(view)).toContain(message);
  });
});
