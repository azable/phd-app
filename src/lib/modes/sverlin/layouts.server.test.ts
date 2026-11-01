import { describe, expect, it } from 'vitest';

import { bundlePresentation, frameSettings, prepareSvelteComponent } from './compile.server';
import layouts from './fixtures/bubble-layouts.sverlin?raw';

/** The fixture's view with its layouts replaced. */
const withView = (view: string) => `${layouts.slice(0, layouts.indexOf('{#layout'))}${view}`;

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
    expect(starter['Stacked.ratio']).toBe('16:9');
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
      ratio: '16:9',
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
      /declares no layout: put what the page draws in \{#layout Main\}/u
    );
  });

  it('draws layouts afresh at random, keeping each frame', async () => {
    const drawn = new Set<unknown>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { variant } = await bundlePresentation(prepared, seed, { randomise: true });
      drawn.add(variant.layout);
      expect(variant['Side.ratio']).toBe('16:9');
      expect(variant['Stacked.padding']).toBe(1.5);
    }
    expect(drawn).toEqual(new Set(['Stacked', 'Side']));
  });

  it.each([
    [
      'something beside the layouts',
      '{@render Title()}\n{#layout A}<Node>{@render Board()}</Node>{/layout}',
      'the top level holds only parts, views, and layouts'
    ],
    [
      'two roots',
      '{#layout A}<Node>{@render Title()}</Node><Node>{@render Board()}</Node>{/layout}',
      'body is one root <Node>'
    ],
    [
      'a free root',
      '{#layout A}<Node layout="free">{@render Board()}</Node>{/layout}',
      'its only prop is layout, "row" or "column"'
    ],
    [
      'a nested layout',
      '{#layout A}<Node>{#if true}{#layout B}<Node>{@render Board()}</Node>{/layout}{/if}</Node>{/layout}',
      'declared at the top level'
    ],
    [
      'two layouts of one name',
      '{#layout A}<Node>{@render Board()}</Node>{/layout}\n{#layout A}<Node>{@render Title()}</Node>{/layout}',
      'Two layouts are named A'
    ],
    [
      "a snippet's name",
      '{#layout Title}<Node>{@render Board()}</Node>{/layout}',
      "has a snippet's name"
    ],
    ['a nameless layout', '{#layout}<Node>{@render Board()}</Node>{/layout}', 'is no layout'],
    [
      'text in the root',
      '{#layout A}<Node>Bubble sort {@render Board()}</Node>{/layout}',
      'Text outside a <Node>'
    ]
  ])('refuses %s', (_, view, message) => {
    expect(problemOf(withView(view))).toContain(message);
  });

  it('keeps every offset, so problems point where they are written', () => {
    const view = '{#layout   A  }\n  <Node>{@render Missing()}</Node>\n{/layout}';
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
});
