import { describe, expect, it } from 'vitest';

import { bundlePresentation, frameSettings, prepareSvelteComponent } from './compile.server';
import layouts from './fixtures/bubble-layouts.sverlin?raw';

/** The fixture's view with its layouts replaced. */
const withView = (view: string) => `${layouts.slice(0, layouts.indexOf('<Layout'))}${view}`;

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

  it('offers every layout, never none, the first to start with', () => {
    expect(space.layout).toEqual(['Stacked', 'Side']);
    expect(starter.layout).toBe('Stacked');
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

  it('draws the frame of the layout shown, arranged as its root says', async () => {
    const built = await bundlePresentation(prepared, 1, {
      chosen: { layout: 'Side', 'Side.ratio': '4:3', 'Stacked.gap': 2 }
    });
    expect(frameSettings(prepared.design, built.variant)).toMatchObject({
      ratio: '4:3',
      gap: 1,
      layout: 'row',
      name: 'Side'
    });
    expect(frameSettings(prepared.design, { ...built.variant, layout: 'Stacked' })).toMatchObject({
      ratio: 'fit',
      gap: 2,
      layout: 'column',
      name: 'Stacked'
    });
    // A variant lacking the layout shows the first.
    const without = Object.fromEntries(
      Object.entries(built.variant).filter(([key]) => key !== 'layout')
    );
    expect(frameSettings(prepared.design, without).name).toBe('Stacked');
  });

  it('refuses a source without layouts, naming the fix', () => {
    expect(problemOf(withView('{@render Title()}\n{@render Board()}'))).toMatch(
      /declares no layout: put what the page draws in <Layout name="Main">/u
    );
  });

  it('draws layouts afresh at random, keeping each frame', async () => {
    const drawn = new Set<unknown>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { variant } = await bundlePresentation(prepared, seed, { randomise: true });
      drawn.add(variant.layout);
      expect(variant['Side.ratio']).toBe('fit');
      expect(variant['Stacked.padding']).toBe(1.5);
    }
    expect(drawn).toEqual(new Set(['Stacked', 'Side']));
  });

  it.each([
    [
      'something beside the layouts',
      '{@render Title()}\n<Layout name="A"><Node>{@render Board()}</Node></Layout>',
      'the top level holds only parts, views, and layouts'
    ],
    [
      'two roots',
      '<Layout name="A"><Node>{@render Title()}</Node><Node>{@render Board()}</Node></Layout>',
      'body is one root <Node>'
    ],
    [
      'a free root',
      '<Layout name="A"><Node layout="free">{@render Board()}</Node></Layout>',
      'its only prop is layout, "row" or "column"'
    ],
    [
      'a nested layout',
      '<Layout name="A"><Node>{#if true}<Layout name="B"><Node>{@render Board()}</Node></Layout>{/if}</Node></Layout>',
      'declared at the top level'
    ],
    [
      'two layouts of one name',
      '<Layout name="A"><Node>{@render Board()}</Node></Layout>\n<Layout name="A"><Node>{@render Title()}</Node></Layout>',
      'Two layouts are named A'
    ],
    [
      "a snippet's name",
      '<Layout name="Title"><Node>{@render Board()}</Node></Layout>',
      "has a snippet's name"
    ],
    ['a nameless layout', '<Layout><Node>{@render Board()}</Node></Layout>', 'is no layout'],
    [
      'a layout closed on itself',
      '<Layout name="A" /><Node>{@render Board()}</Node>',
      '<Layout name="A" /> holds nothing'
    ],
    [
      'a closing without its >',
      '<Layout name="A"><Node>{@render Board()}</Node></Layout\n',
      '</Layout does not close the layout: close the layout with </Layout>.'
    ],
    [
      'a layout never closed',
      '<Layout name="A"><Node>{@render Board()}</Node>\n<Layout name="B"><Node>{@render Title()}</Node></Layout>',
      'The layout A is never closed: close the layout with </Layout>'
    ],
    [
      'a closing without an opening',
      '<Layout name="A"><Node>{@render Board()}</Node></Layout></Layout>',
      'This </Layout> closes no layout'
    ],
    [
      'only a closing',
      '<Node>{@render Board()}</Node></Layout>',
      'This </Layout> closes no layout'
    ],
    [
      'text in the root',
      '<Layout name="A"><Node>Bubble sort {@render Board()}</Node></Layout>',
      'Text outside a <Node>'
    ]
  ])('refuses %s', (_, view, message) => {
    expect(problemOf(withView(view))).toContain(message);
  });

  it('keeps every offset, so problems point where they are written', () => {
    const view = '<Layout name="A">\n  <Node>{@render Missing()}</Node>\n</Layout>';
    const source = withView(view);
    try {
      prepareSvelteComponent(source);
      expect.unreachable();
    } catch (cause) {
      const { line, column } = cause as { line: number; column: number };
      const lines = source.split('\n');
      expect(lines[line - 1].slice(column - 1)).toMatch(/^\{@render Missing/u);
    }
  });

  it('points at a malformed closing', () => {
    const source = withView('<Layout name="A">\n  <Node>{@render Board()}</Node>\n</Layout');
    try {
      prepareSvelteComponent(source);
      expect.unreachable();
    } catch (cause) {
      const { line, column } = cause as { line: number; column: number };
      expect(source.split('\n')[line - 1].slice(column - 1)).toBe('</Layout');
    }
  });
});
