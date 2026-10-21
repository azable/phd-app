import { describe, expect, it } from 'vitest';

import { applySourceEdits } from './source-edits';

const source = '<Node layout="row">\n  <Node>a</Node>\n  <Node>b</Node>\n</Node>';

describe('source edits', () => {
  it('replaces each find text, in order, in the source as the edits before it left it', () => {
    expect(
      applySourceEdits(source, [
        { find: '<Node>a</Node>', replace: '<Node>c</Node>' },
        { find: '<Node>c</Node>\n  <Node>b</Node>', replace: '<Node>d</Node>' }
      ])
    ).toEqual({ source: '<Node layout="row">\n  <Node>d</Node>\n</Node>' });
  });

  it('reports each edit it cannot place, and applies none', () => {
    const result = applySourceEdits(source, [
      { find: '<Node>z</Node>', replace: '' },
      { find: '<Node>', replace: '<Node size="large">' },
      { find: '', replace: 'x' }
    ]);
    expect(result).toEqual({
      problems: [
        expect.stringContaining('Edit 1'),
        expect.stringContaining('Edit 2'),
        'Edit 3 has no text to find.'
      ]
    });
    expect(applySourceEdits(source, [])).toEqual({ problems: ['No edits were given.'] });
  });
});
