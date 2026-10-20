import { describe, expect, it } from 'vitest';

import { drawnDefaults, tagDefaults } from './drawn-defaults';

const defaults = (radius: string, fill: string) => ({
  box: { radius, fill, scale: 1.25 },
  font: 'serif'
});

describe('drawn defaults', () => {
  it('flattens each presentation’s defaults by key and flags those a pair drew differently', () => {
    const rows = drawnDefaults([
      { label: 'top', defaults: defaults('full', 'hsl(120 20% 95%)') },
      { label: 'bottom', defaults: defaults('small', 'var(--sv-surface)') }
    ]);
    expect(rows.map(({ key, differs }) => [key, differs])).toEqual([
      ['box.radius', true],
      ['box.fill', true],
      ['box.scale', false],
      ['font', false]
    ]);
    expect(rows[1].values).toEqual([
      { label: 'top', text: 'hsl(120 20% 95%)', color: 'hsl(120 20% 95%)' },
      { label: 'bottom', text: 'plain' }
    ]);
  });

  it('shows nothing for presentations without recorded defaults', () => {
    expect(drawnDefaults([{ defaults: undefined }])).toEqual([]);
  });

  it('gives each tag one ghost prop per default it takes, comparing a box’s and a card’s radius', () => {
    const tags = tagDefaults([
      {
        label: 'top',
        defaults: { box: { radius: 'full', fill: 'hsl(1 2% 3%)' }, card: { radius: 'small' } },
        nodeDefaults: [
          { line: 3, column: 5, defaults: ['box.radius', 'box.fill'] },
          { line: 3, column: 5, defaults: ['box.radius'] }
        ]
      },
      {
        label: 'bottom',
        defaults: { box: { radius: 'full' }, card: { radius: 'small' } },
        nodeDefaults: [{ line: 3, column: 5, defaults: ['card.radius'] }]
      }
    ]);
    expect(tags).toHaveLength(1);
    expect(
      tags[0].props.map(({ name, values, differs }) => ({
        name,
        texts: values.map(({ text }) => text),
        differs
      }))
    ).toEqual([
      { name: 'radius', texts: ['full', 'small'], differs: true },
      { name: 'fill', texts: ['hsl(1 2% 3%)', '–'], differs: true }
    ]);
  });

  it('writes each value as the prop that keeps it, except a text scale no prop sets', () => {
    const [tag] = tagDefaults([
      {
        defaults: { box: { radius: 'full', scale: 1.25 }, gap: 'small' },
        nodeDefaults: [{ line: 1, column: 1, defaults: ['box.radius', 'box.scale', 'gap'] }]
      }
    ]);
    expect(tag.props.map(({ values }) => values[0].pin)).toEqual([
      'radius="full"',
      undefined,
      'gap="small"'
    ]);
  });
});
