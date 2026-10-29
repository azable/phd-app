import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { linearSearchSource } from './contract';
import bst from './fixtures/bst.sverlin?raw';
import bfs from './fixtures/bfs-visit-order.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import { formsFor } from './library/node/forms';
import {
  buildVariant,
  DesignValueError,
  listingRegionFallbacks,
  listingRegionSpace
} from './design.server';

const prepared = prepareSvelteComponent(linearSearchSource);
const { space, starter } = prepared.design;

describe('design space', () => {
  it('has every view of each type rendered by name, the frame, and every prop of every kind', () => {
    expect(space['views.Int']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(space['views.Index']).toEqual(['IndexText', 'none']);
    expect(space['frame.ratio']).toContain('4:3');
    const kinds = new Set(
      Object.keys(space)
        .filter(
          (key) =>
            !key.startsWith('views.') &&
            !key.startsWith('pointers.') &&
            !key.startsWith('frame.') &&
            !key.includes('@')
        )
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    );
    expect([...kinds].sort()).toEqual(
      [
        'Title',
        'Caption',
        'Ask',
        'Checking',
        'Result',
        'IntCell',
        'IntTally',
        'IntTally.Tally',
        'IndexText',
        'Row',
        'Row.Under',
        'Highlight.Pointed'
      ].sort()
    );
    // A layout's props, and nothing to hide a <Pointed> by.
    expect(space['Row.gap']).toBeDefined();
    expect(space['IntCell.gap']).toBeUndefined();
    expect(space['Highlight.Pointed.shown']).toBeUndefined();
    expect(space['Highlight.Pointed.fill']).toContain('amber-100');
    // Overflow: a pointer's, drawn past the ends or not; a collection's, its end slots in its box
    // or hanging outside it. Dashed borders are paint, for any node.
    expect(space['Highlight.Pointed.overflow']).toEqual(['shown', 'hidden']);
    expect(space['IntTally.Tally.overflow']).toBeUndefined();
    expect(space['Row.overflow']).toEqual(['included', 'excluded']);
    expect(space['IntCell.overflow']).toBeUndefined();
    expect(space['IntCell.strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
  });

  it('records the kind of each tag, by its line and column', () => {
    const lines = linearSearchSource.split('\n');
    const line = lines.findIndex((text) => text.includes('<Pointed'));
    const position = `${line + 1}:${lines[line].indexOf('<Pointed') + 1}`;
    expect(prepared.design.tags[position]).toEqual(['Highlight.Pointed']);
  });

  it('starts every variable at the starter, each type in its first view', () => {
    expect(Object.keys(starter).sort()).toEqual(Object.keys(space).sort());
    expect(starter['views.Int']).toBe('IntCell');
    for (const [key, value] of Object.entries(starter)) expect(space[key]).toContain(value);
  });
});

describe('variants', () => {
  it('takes chosen values, keeps a base where it fits, and gives the rest the starter', () => {
    const { values, origins } = buildVariant(
      space,
      starter,
      {
        chosen: { 'views.Int': 'IntTally' },
        base: { 'IntCell.radius': 999, 'IntCell.fill': 'not-a-colour', gone: 1 }
      },
      1
    );
    expect(values['views.Int']).toBe('IntTally');
    expect(origins['views.Int']).toBe('chosen');
    expect(values['IntCell.radius']).toBe(999);
    expect(origins['IntCell.radius']).toBe('kept');
    expect(values['IntCell.fill']).toBe(starter['IntCell.fill']);
    expect(origins['IntCell.fill']).toBe('starter');
    expect(values).not.toHaveProperty('gone');
  });

  it('rejects a chosen value outside its options, or for no variable', () => {
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.radius': 3 } }, 1)).toThrow(
      DesignValueError
    );
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.radius': 3 } }, 1)).toThrow(
      'IntCell.radius cannot be 3'
    );
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.depth': 1 } }, 1)).toThrow(
      'IntCell has no prop depth'
    );
    // A view choice for a place the source has not is no variable, not a prop of "pointers".
    expect(() =>
      buildVariant(space, starter, { chosen: { 'pointers.Index@found': 'Arrow' } }, 1)
    ).toThrow('The design has no variable pointers.Index@found; its view choices are views.Int');
  });

  it('keeps a place as its kinds are until a variant sets it apart', () => {
    const { fallbacks } = prepared.design;
    const [first, second] = space['Highlight.Pointed.fill'].filter(
      (option) => option !== 'none' && option !== starter['Highlight.Pointed.fill']
    );
    // A place follows the kind it falls back to.
    const followed = buildVariant(
      space,
      starter,
      { chosen: { 'Highlight.Pointed.fill': first } },
      1,
      fallbacks
    ).values;
    expect(followed['Highlight.Pointed@found.fill']).toBe(first);
    // Chosen, it is set apart, and stays so as the kind changes.
    const apart = buildVariant(
      space,
      starter,
      { chosen: { 'Highlight.Pointed@found.fill': second } },
      1,
      fallbacks
    ).values;
    expect(apart['Highlight.Pointed@found.fill']).toBe(second);
    expect(apart['Highlight.Pointed@i.fill']).toBe(starter['Highlight.Pointed.fill']);
    const kept = buildVariant(
      space,
      starter,
      { base: apart, chosen: { 'Highlight.Pointed.fill': first } },
      1,
      fallbacks
    ).values;
    expect(kept['Highlight.Pointed@found.fill']).toBe(second);
    expect(kept['Highlight.Pointed@i.fill']).toBe(first);
  });

  it('randomises keeping equalities, shades, and what is shown or none', () => {
    const variants = Array.from(
      { length: 8 },
      (_, seed) => buildVariant(space, starter, { randomise: true }, seed + 1).values
    );
    for (const values of variants) {
      // Every kind that shared the starter's text colour still shares one.
      const colours = Object.entries(values)
        .filter(([key]) => key.endsWith('.color') && starter[key] === starter['IntCell.color'])
        .map(([, value]) => value);
      expect(new Set(colours).size).toBe(1);
      expect(String(colours[0])).toMatch(/-900$/u);
      expect(values['Row.Under.shown']).toBe(true);
      expect(values['Row.fill']).toBe('none');
      expect(values['views.Int']).not.toBe('none');
    }
    expect(
      new Set(variants.map((values) => values['Highlight.Pointed.fill'])).size
    ).toBeGreaterThan(1);
    expect(buildVariant(space, starter, { randomise: true }, 3).values).toEqual(variants[2]);
  });

  it('randomises only the variables named', () => {
    const { values, origins } = buildVariant(
      space,
      starter,
      { randomise: ['views.Int'], base: { 'IntCell.radius': 999 } },
      2
    );
    expect(values['IntCell.radius']).toBe(999);
    expect(Object.entries(origins).filter(([, origin]) => origin === 'random').length).toBeLessThan(
      2
    );
  });

  it('bundles a presentation drawing its variant', async () => {
    const bundle = await bundlePresentation(prepared, 1, {
      chosen: { 'views.Int': 'IntTally', 'Row.Under.shown': false }
    });
    expect(bundle.variant['views.Int']).toBe('IntTally');
    expect(bundle.origins['Row.Under.shown']).toBe('chosen');
    expect(bundle.javascript).toContain('"views.Int":"IntTally"');
  });
});

describe('listing regions', () => {
  it('fall back to the mark of the view the place chose, or the level, by order', () => {
    const marks = new Map([
      [
        'pass.left',
        {
          kinds: { Arrow: 'Arrow.Pointed@pass.left', Mark: 'Mark.Pointed@pass.left' },
          by: 'pointers.Position@pass.left'
        }
      ]
    ]);
    const fallbacks = {
      'pointers.Position@pass.left': 'pointers.Position',
      'Arrow.Pointed@pass.left.fill': 'Arrow.Pointed.fill',
      'Mark.Pointed@pass.left.fill': 'Mark.Pointed.fill',
      ...listingRegionFallbacks(['pass', 'pass.left'], marks)
    };
    const regionSpace = listingRegionSpace(['pass', 'pass.left']);
    const designed = {
      'pointers.Position': ['Arrow', 'Mark', 'none'],
      'pointers.Position@pass.left': ['Arrow', 'Mark', 'none'],
      'Arrow.Pointed.fill': ['none', 'sky-100'],
      'Mark.Pointed.fill': ['none', 'rose-100'],
      'Arrow.Pointed@pass.left.fill': ['none', 'sky-100'],
      'Mark.Pointed@pass.left.fill': ['none', 'rose-100'],
      'listing.lit.fill': ['none', 'amber-200'],
      'listing.lit.stroke': ['none'],
      'listing.lit.color': ['none'],
      ...regionSpace
    };
    const start = Object.fromEntries(
      Object.entries(designed).map(([key, [first]]) => [key, first])
    );
    const values = (chosen: Record<string, string>) =>
      buildVariant(designed, start, { chosen }, 1, fallbacks).values;
    const shared = {
      'Arrow.Pointed.fill': 'sky-100',
      'Mark.Pointed.fill': 'rose-100',
      'listing.lit.fill': 'amber-200'
    };
    expect(values({ ...shared, 'pointers.Position': 'Mark' })['listing.lit@pass.left.fill']).toBe(
      'rose-100'
    );
    expect(values({ ...shared, 'pointers.Position': 'Arrow' })['listing.lit@pass.left.fill']).toBe(
      'sky-100'
    );
    // A place drawing no mark, and a region with no mark, take the level's own.
    const none = values({ ...shared, 'pointers.Position@pass.left': 'none' });
    expect(none['listing.lit@pass.left.fill']).toBe('amber-200');
    expect(none['listing.lit@pass.fill']).toBe('amber-200');
  });
});

describe('pauses chosen', () => {
  it('read accumulating as on at a label with no labels inside it', () => {
    const space = { 'pause@sweep': ['accumulate', 'on', 'off'], 'pause@sweep.pair': ['on', 'off'] };
    const starter = { 'pause@sweep': 'on', 'pause@sweep.pair': 'on' };
    const chosen = { 'pause@sweep': 'accumulate', 'pause@sweep.pair': 'accumulate' };
    expect(buildVariant(space, starter, { chosen }, 1).values).toEqual({
      'pause@sweep': 'accumulate',
      'pause@sweep.pair': 'on'
    });
  });
});

describe('free layouts', () => {
  const tree = prepareSvelteComponent(bst).design;

  it('give the kind arranging one its form, curve, and layout seed', () => {
    expect(tree.space['Heap.form']).toEqual(formsFor('tree', 'y'));
    expect(tree.space['Heap.curve']).toEqual(['straight', 'curved']);
    expect(tree.space['Heap.layoutSeed']).toContain(1);
    expect(tree.starter).toMatchObject({
      'Heap.form': 'tree-down',
      'Heap.curve': 'straight',
      'Heap.layoutSeed': 1
    });
    // Rows and columns have no such look.
    expect(Object.keys(space).filter((key) => key.endsWith('.form'))).toEqual([]);
    expect(Object.keys(tree.space).filter((key) => key.endsWith('.form'))).toEqual(['Heap.form']);
  });

  it('keep the layout of the variant built on unless a value changes it', () => {
    const base = { ...tree.starter, 'Heap.form': 'indented', 'Heap.layoutSeed': 7 };
    const paced = buildVariant(tree.space, tree.starter, { base, chosen: {} }, 99).values;
    expect(paced).toMatchObject({ 'Heap.form': 'indented', 'Heap.layoutSeed': 7 });
    const contrasted = buildVariant(
      tree.space,
      tree.starter,
      { base, chosen: { 'Heap.form': 'snake' } },
      99
    ).values;
    expect(contrasted).toMatchObject({ 'Heap.form': 'snake', 'Heap.layoutSeed': 7 });
    // A form the structure cannot take is refused, naming the ones it can.
    expect(() =>
      buildVariant(tree.space, tree.starter, { chosen: { 'Heap.form': 'ring' } }, 1)
    ).toThrow(DesignValueError);
  });

  it('give a link’s kind its route, head, and head size, which a vary keeps', () => {
    const graph = prepareSvelteComponent(bfs).design;
    expect(graph.space['Graph.Link.route']).toEqual(['layout', 'straight', 'curved', 'wire']);
    expect(graph.space['Graph.Link.head']).toEqual([
      'none',
      'arrow',
      'open',
      'vee',
      'dot',
      'diamond',
      'bar'
    ]);
    expect(graph.space['Graph.Link.headSize']).toEqual([6, 9, 12, 16]);
    expect(graph.space['Graph.Link.curve']).toBeUndefined();
    expect(graph.space['Graph.Link.color']).toBeUndefined();
    expect(graph.starter).toMatchObject({
      'Graph.Link.route': 'layout',
      'Graph.Link.head': 'arrow',
      'Graph.Link.headSize': 9
    });
    const base = { ...graph.starter, 'Graph.Link.route': 'wire', 'Graph.Link.head': 'vee' };
    expect(buildVariant(graph.space, graph.starter, { base }, 5).values).toMatchObject({
      'Graph.Link.route': 'wire',
      'Graph.Link.head': 'vee'
    });
  });

  it('start a link’s head at none where every link of its kind is a two-way line', () => {
    expect(prepareSvelteComponent(undirected).design.starter).toMatchObject({
      'Graph.Link.head': 'none'
    });
    expect(prepareSvelteComponent(bfs).design.starter).toMatchObject({
      'Graph.Link.head': 'arrow'
    });
  });
});
