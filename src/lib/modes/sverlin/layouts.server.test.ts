import { describe, expect, it } from 'vitest';

import { frameSettings, prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import layouts from './fixtures/bubble-layouts.sverlin?raw';

/** The fixture's view with its page layouts replaced. */
const withView = (view: string) =>
  `${layouts.slice(0, layouts.indexOf('<Layout name="Stacked"'))}${view}\n${/<Case\b[^\n]*\/>/u.exec(layouts)?.[0] ?? ''}`;

const problemOf = (source: string) => {
  try {
    prepareSvelteComponent(source);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('layouts of the page', () => {
  const prepared = prepareSvelteComponent(layouts);
  const { space, starter } = prepared.design;

  it('offers no choice of layout, the scenes saying which shows when', () => {
    expect(space).not.toHaveProperty('layout');
    expect(prepared.storyboard.scenes.map(({ name, layout }) => [name, layout])).toEqual([
      ['stacked', 'Stacked'],
      ['side', 'Side']
    ]);
  });

  it('gives each layout its frame as a kind, with the nodes its body writes', () => {
    expect(starter['Stacked.ratio']).toBe('fit');
    expect(starter['Side.gap']).toBe(1);
    expect(space['Side.ratio']).toContain('4:3');
    // The Side layout writes a node of its own, of its kind; the frame takes the shared props.
    expect(space).toHaveProperty('Side.fill');
    expect(space).not.toHaveProperty('Stacked.fill');
    expect(Object.keys(space).some((key) => key.startsWith('frame.'))).toBe(false);
    expect(space).not.toHaveProperty('Stacked.layout');
  });

  it('marks each root tag with its layout, for the editor', () => {
    const line = layouts.split('\n').findIndex((text) => text.includes('<Node layout="row">'));
    expect(prepared.design.tags[`${line + 1}:3`]).toEqual(['Side']);
    expect(prepared.design.layouts.map(({ name, direction }) => [name, direction])).toEqual([
      ['Stacked', 'column'],
      ['Side', 'row']
    ]);
  });

  it('keeps every line under a layout opening written over several lines, so tags name their lines', () => {
    const opening = layouts.match(/<Layout name="Side"[^>]*>/u)![0];
    const spread = layouts.replace(
      opening,
      opening.replace('<Layout name=', '<Layout\n  name=').replace(' of=', '\n  of=')
    );
    const line = spread.split('\n').findIndex((text) => text.includes('<Node layout="row">'));
    expect(prepareSvelteComponent(spread).design.tags[`${line + 1}:3`]).toEqual(['Side']);
  });

  it('draws the frame of the layout a scene shows, arranged as its root says', async () => {
    const built = await bundlePresentation(prepared, 1, {
      chosen: { 'Side.ratio': '4:3', 'Stacked.gap': 2 }
    });
    expect(frameSettings(prepared.design, built.variant, 'Side')).toMatchObject({
      ratio: '4:3',
      gap: 1,
      layout: 'row',
      name: 'Side'
    });
    expect(frameSettings(prepared.design, built.variant, 'Stacked')).toMatchObject({
      ratio: 'fit',
      gap: 2,
      layout: 'column',
      name: 'Stacked'
    });
  });

  it('refuses a source without layouts, naming the fix', () => {
    const unlaid = `${layouts.slice(0, layouts.indexOf('<Layout'))}<Node>Bubble sort</Node>`;
    expect(problemOf(unlaid)).toMatch(
      /declares no layout: put what the page draws in <Layout name="Main">/u
    );
  });

  it('draws each layout afresh at random, keeping each frame', async () => {
    for (const seed of [1, 2, 3]) {
      const { variant } = await bundlePresentation(prepared, seed, { randomise: true });
      expect(variant).not.toHaveProperty('layout');
      expect(variant['Side.ratio']).toBe('fit');
      expect(variant['Stacked.padding']).toBe(1.5);
    }
  });

  it.each([
    [
      'something beside the layouts',
      '<Title />\n<Layout name="A" of="values, @pass"><Node><Board values={values} /></Node></Layout>',
      'The top level holds only views and layouts'
    ],
    [
      'two roots',
      '<Layout name="A" of="values, @pass"><Node><Title /></Node><Node><Board values={values} /></Node></Layout>',
      'body is one root <Node>'
    ],
    [
      'a free root',
      '<Layout name="A" of="values, @pass"><Node layout="free"><Board values={values} /></Node></Layout>',
      'its only prop is layout, "row" or "column"'
    ],
    [
      'a nested layout',
      '<Layout name="A" of="values, @pass"><Node>{#if true}<Layout name="B" of="values, @pass"><Node><Board values={values} /></Node></Layout>{/if}</Node></Layout>',
      'declared at the top level'
    ],
    [
      'two layouts of one name',
      '<Layout name="A" of="values, @pass"><Node><Board values={values} /></Node></Layout>\n<Layout name="A" of="values, @pass"><Node><Title /></Node></Layout>',
      'Two layouts are named A'
    ],
    [
      "a view's name",
      '<Layout name="Cells" of="values, @pass"><Node><Board values={values} /></Node></Layout>',
      "has a view's name"
    ],
    [
      'a nameless layout',
      '<Layout><Node><Board values={values} /></Node></Layout>',
      'is no layout'
    ],
    [
      'a layout closed on itself',
      '<Layout name="A" /><Node><Board values={values} /></Node>',
      '<Layout name="A" /> holds nothing'
    ],
    [
      'a closing without its >',
      '<Layout name="A" of="values, @pass"><Node><Board values={values} /></Node></Layout\n',
      '</Layout does not close the layout: close the layout with </Layout>.'
    ],
    [
      'a layout never closed',
      '<Layout name="A" of="values, @pass"><Node><Board values={values} /></Node>\n<Layout name="B" of="values, @pass"><Node><Title /></Node></Layout>',
      'The layout A is never closed: close the layout with </Layout>'
    ],
    [
      'a closing without an opening',
      '<Layout name="A" of="values, @pass"><Node><Board values={values} /></Node></Layout></Layout>',
      'This </Layout> closes no layout'
    ],
    [
      'only a closing',
      '<Node><Board values={values} /></Node></Layout>',
      'This </Layout> closes no layout'
    ],
    [
      'a view written as a tag',
      '<Layout name="A" of="values, @pass"><Node><Cells values={values} /></Node></Layout>',
      '<Cells> is a view of Values, which is drawn by writing a value of Values in braces, not by its tag: write the value, as {values}'
    ],
    [
      'text in the root',
      '<Layout name="A" of="values, @pass"><Node>Bubble sort <Board values={values} /></Node></Layout>',
      'Text outside a <Node>'
    ]
  ])('refuses %s', (_, view, message) => {
    expect(problemOf(withView(view))).toContain(message);
  });

  it.each([
    ['on one line', '<Layout name="A" of="values, @pass">'],
    ['over several lines', '<Layout\n  name="A"\n  of="values,\n      @pass">']
  ])(
    'keeps every offset, an opening written %s, so problems point where they are written',
    (_, opening) => {
      const view = `${opening}\n  <Node><Title /><Board values={values} /><Missing /></Node>\n</Layout>`;
      const source = withView(view);
      try {
        prepareSvelteComponent(source);
        expect.unreachable();
      } catch (cause) {
        const { line, column } = cause as { line: number; column: number };
        const lines = source.split('\n');
        expect(lines[line - 1].slice(column - 1)).toMatch(/^<Missing/u);
      }
    }
  );

  it('points at a malformed closing', () => {
    const source = withView(
      '<Layout name="A" of="values, @pass">\n  <Node><Board values={values} /></Node>\n</Layout'
    );
    try {
      prepareSvelteComponent(source);
      expect.unreachable();
    } catch (cause) {
      const { line, column } = cause as { line: number; column: number };
      expect(source.split('\n')[line - 1].slice(column - 1)).toBe('</Layout');
    }
  });
});
