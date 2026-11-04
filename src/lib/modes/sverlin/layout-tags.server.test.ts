import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';

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
<View of="Index" name="IndexText"><Node value={this} /></View>
`;

const target = '<Layout name="Target" of="target"><Node>{target}</Node></Layout>\n';
const main = (body: string, of = 'values, target, lo, hi') =>
  `<Layout name="Main" of="${of}">\n  <Node>\n    ${body}\n    {values}\n    {lo}\n    {hi}\n  </Node>\n</Layout>\n${scene(of)}`;
/** One scene showing Main, passing the variables it declares. */
const scene = (of: string) =>
  `<Storyboard><Scene name="main"><Main${of
    .split(', ')
    .filter((input) => input && !input.startsWith('@'))
    .map((input) => ` ${input}={${input}}`)
    .join('')} /></Scene></Storyboard>`;

const problemOf = (view: string) => {
  try {
    prepareSvelteComponent(`${blocks}${view}`);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('layouts with inputs', () => {
  it('draws a layout by its tag, inline in a line of text as a value is', () => {
    const prepared = prepareSvelteComponent(
      `${blocks}${target}${main('<Target target={target} /><Node>Searching for <Target target={target} /> in the list</Node>')}`
    );
    expect(prepared.design.space).toHaveProperty('Target.fill');
    expect(Object.keys(prepared.design.space)).not.toContain('Main.Target.fill');
  });

  it('takes a label declared by a shorter one around it', () => {
    const reading =
      '<Layout name="Asked" of="@probe"><When of="@probe.check"><Node>checking</Node></When></Layout>\n' +
      main('<Asked />', 'values, target, lo, hi, @probe');
    expect(problemOf(reading)).toBe('');
  });

  it.each([
    [
      'a tag missing an input',
      `${target}${main('<Target />')}`,
      '<Target> declares target among its inputs, and this tag passes none: pass it, as target={target}.'
    ],
    [
      'a tag passing an input the layout has not',
      `${target}${main('<Target target={target} lo={lo} />')}`,
      'Target has no input lo: it declares of="target".'
    ],
    [
      'an input passed another value',
      `${target}${main('<Target target={values[0]} />')}`,
      'target={values[0]} passes target another value: an input is passed as the state of its own name, as target={target}'
    ],
    [
      'an input the drawing layout does not declare',
      `${target}${main('<Target target={target} />', 'values, lo, hi')}`,
      'Main passes target to Target without reading it: add target to Main\'s inputs, of="values, lo, hi, target".'
    ],
    [
      'a label the drawing layout does not declare',
      `<Layout name="Asked" of="@probe.check"><When of="@probe.check"><Node>checking</Node></When></Layout>\n${main('<Asked />')}`,
      "Asked reads @probe.check, which Main gives it by name: add @probe.check to Main's inputs."
    ],
    [
      'a tag left open',
      `${target}${main('<Target target={target}></Target>')}`,
      "<Target> holds nothing: a layout's tag passes its inputs and draws the layout, so close it at once, as <Target target={target} />."
    ],
    [
      'a layout drawn inside itself',
      `<Layout name="A"><Node><B /></Node></Layout>\n<Layout name="B"><Node><A /></Node></Layout>\n${main('<A />')}`,
      'a layout drawn inside itself would draw without end'
    ],
    [
      'a tag in a view',
      `<View of="Int" name="Labelled"><Node><Target target={target} /></Node></View>\n${target}${main('')}`,
      "<Target … /> draws a layout, which reads the algorithm's state, and a view reads only its value"
    ],
    [
      'two layouts of one name',
      `${target}${target}${main('<Target target={target} />')}`,
      'Two layouts are named Target'
    ],
    [
      'an input that is no variable',
      `<Layout name="Shown" of="nothing"><Node>shown</Node></Layout>\n${main('')}`,
      'Shown declares nothing, which is no variable of the input or algorithm'
    ],
    [
      'a variable read without declaring it',
      main('', 'values, lo'),
      'Main reads hi without declaring it: a layout reads only its inputs, so add it, of="values, lo, hi".'
    ],
    [
      'a label read without declaring it',
      main('<When of="@probe.check"><Node>checking</Node></When>'),
      'Main reads @probe.check without declaring it'
    ],
    [
      'a prop other than name and of',
      `<Layout name="Shown" kind="X"><Node>shown</Node></Layout>\n${main('')}`,
      'A <Layout> takes only name and of'
    ],
    [
      'inputs computed',
      `<Layout name="Shown" of={inputs}><Node>shown</Node></Layout>\n${main('')}`,
      'is written as it is, not computed'
    ]
  ])('refuses %s', (_, view, message) => {
    expect(problemOf(view)).toContain(message);
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
      '{#snippet Title()} is written as a layout: <Layout name="Title" of="…">…</Layout>, declaring the state it reads, rendered where it is drawn as <Title … />.'
    ],
    [
      'a render of a value',
      main('<Node>{@render Cell(target)}</Node>'),
      "{@render Cell(target)} is written {target}: a value in braces draws its type's view."
    ],
    [
      'a render of a layout',
      `${target}${main('{@render Target()}')}`,
      "{@render Target()} is written as the layout's tag, <Target … />, passing the state it declares."
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
