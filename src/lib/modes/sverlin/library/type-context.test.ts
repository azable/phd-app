import { describe, expect, it } from 'vitest';

import { elementSlot, keyedRef } from './type-context';

describe('element slots', () => {
  it('name the element a slot draws, nested or not', () => {
    expect(elementSlot('values[2]')).toEqual({ collection: 'values', index: 2 });
    expect(elementSlot('paths[1][2]')).toEqual({ collection: 'paths[1]', index: 2 });
    expect(elementSlot('edges[0].to')).toBeUndefined();
  });
});

describe('keyed references', () => {
  it('keep a short key as written, and a long one as a hash, so different ends stay apart', () => {
    expect(keyedRef('3:5', 'a->b')).toBe('3:5@a-%3Eb');
    const one = keyedRef('3:5', 'nodes[1]->nodes[0]');
    const other = keyedRef('3:5', 'nodes[1]->nodes[2]');
    expect(one).toMatch(/^3:5@~[0-9a-z]+$/u);
    expect(one).not.toBe(other);
    expect(keyedRef('3:5', 'nodes[1]->nodes[0]')).toBe(one);
  });
});
