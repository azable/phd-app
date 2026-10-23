import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { linearSearchSource } from './contract';
import { buildVariant, DesignValueError } from './design.server';

const prepared = prepareSvelteComponent(linearSearchSource);
const { space, starter } = prepared.design;

describe('design space', () => {
  it('has every view of each type rendered by name, the frame, and every prop of every kind', () => {
    expect(space['views.Int']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(space['views.Index']).toEqual(['IndexText', 'none']);
    expect(space['frame.ratio']).toContain('4:3');
    const kinds = new Set(
      Object.keys(space)
        .filter((key) => !key.startsWith('views.') && !key.startsWith('frame.') && key !== 'frames')
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    );
    expect([...kinds].sort()).toEqual(
      [
        'root[title]',
        'root[caption]',
        'root[status]',
        'IntCell',
        'IntTally',
        'IntTally[tally]',
        'IndexText',
        'Row',
        'Row[index]',
        'Current',
        'Current[current]',
        'Current[current,found]',
        'Current[label]'
      ].sort()
    );
    // A layout's props, and nothing to hide a <Pointed> by.
    expect(space['Row.gap']).toBeDefined();
    expect(space['IntCell.gap']).toBeUndefined();
    expect(space['Current[current].shown']).toBeUndefined();
    expect(space['Current[current].fill']).toContain('amber-100');
    // Overflow: a pointer's, drawn past the ends or not; a collection's, its end slots in its box
    // or hanging outside it. Dashed borders are paint, for any node.
    expect(space['Current[current].overflow']).toEqual(['shown', 'hidden']);
    expect(space['Current[current,found].overflow']).toBeUndefined();
    expect(space['Row.overflow']).toEqual(['included', 'excluded']);
    expect(space['IntCell.overflow']).toBeUndefined();
    expect(space['IntCell.strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
  });

  it('records the kinds each tag can be, by its line and column', () => {
    const lines = linearSearchSource.split('\n');
    const line = lines.findIndex((text) => text.includes('<Pointed'));
    const position = `${line + 1}:${lines[line].indexOf('<Pointed') + 1}`;
    expect(prepared.design.tags[position]).toEqual(['Current[current]', 'Current[current,found]']);
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
      expect(values['Row[index].shown']).toBe(true);
      expect(values['Row.fill']).toBe('none');
      expect(values['views.Int']).not.toBe('none');
    }
    expect(new Set(variants.map((values) => values['Current[current].fill'])).size).toBeGreaterThan(
      1
    );
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
      chosen: { 'views.Int': 'IntTally', 'Row[index].shown': false }
    });
    expect(bundle.variant['views.Int']).toBe('IntTally');
    expect(bundle.origins['Row[index].shown']).toBe('chosen');
    expect(bundle.javascript).toContain('"views.Int":"IntTally"');
  });
});

describe('kinds a tag the state decides draws', () => {
  const source = `<script lang="sverlin" domain>const Int = type('integer', { min: 0, max: 9 }); const Values = collection(Int);</script><script lang="sverlin" input>const values = Values([3, 8]);</script><script lang="sverlin">/* @step */ values.reverse(); /* @step */ values.reverse();</script>
<Node layout="row">{#each values as value, k}<Node layout="column" tags={k < step && 'checked'}>{value}</Node>{/each}</Node>
<Node tags={step ? 'late' : 'early'}>text</Node>`;
  const prepared = prepareSvelteComponent(source);
  const { space } = prepared.design;

  it('vary paint, text, and inset, leaving layout and what is shown to the base kind', () => {
    expect(space['root[checked].fill']).toBeDefined();
    expect(space['root[checked].padding']).toBeDefined();
    expect(space['root[checked].size']).toBeDefined();
    expect(space['root[checked].gap']).toBeUndefined();
    expect(space['root[checked].shown']).toBeUndefined();
    expect(space['root[checked].strokeStyle']).toBeDefined();
    expect(space['root.gap']).toBeDefined();
    expect(space['root.shown']).toBeDefined();
  });

  it('keep a base kind even where no step draws it alone', () => {
    expect(space['root[early].shown']).toBeUndefined();
    expect(space['root[late].fill']).toBeDefined();
    expect(prepared.design.tags['3:1']).toEqual(['root[late]', 'root[early]']);
    expect(space['root.padding']).toBeDefined();
  });

  it('stamp a tag with its base tags and every kind it can be', () => {
    expect(prepared.component).toContain('__site: ["root", "root[checked]"]');
    expect(prepared.component).toContain("__base: ''");
  });
});
