import { describe, expect, it } from 'vitest';

import { cutText, storableJson } from './text';

describe('cutText', () => {
  it('never cuts between the halves of an emoji', () => {
    expect(cutText('ab🍎', 3)).toBe('ab');
    expect(cutText('ab🍎', 4)).toBe('ab🍎');
    expect(cutText('abc', 2)).toBe('ab');
  });
});

describe('storableJson', () => {
  it('replaces lone surrogates and drops NULs in every string, keys included', () => {
    const half = '🍎'.slice(0, 1);
    expect(storableJson({ [`k${half}`]: [`a${half}b\u0000`, 1, null, { ok: '🍎' }] })).toEqual({
      'k\ufffd': ['a\ufffdb', 1, null, { ok: '🍎' }]
    });
  });
});
