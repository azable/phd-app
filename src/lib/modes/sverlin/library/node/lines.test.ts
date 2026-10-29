import { describe, expect, it } from 'vitest';

import { linePairs, pairOf } from './lines';

describe('links drawn as lines', () => {
  it('pairs a link with its reverse from the same tag, ends in place order', () => {
    expect(pairOf('3:5', 'vertices[10]', 'vertices[2]')).toBe('3:5|vertices[2]|vertices[10]');
    expect(pairOf('3:5', 'vertices[2]', 'vertices[2]')).toBeUndefined();
  });

  it('draws a pair as a line only where both ways show at exactly the same steps', () => {
    const a = '3:5|vertices[0]|vertices[1]';
    const b = '3:5|vertices[1]|vertices[2]';
    const steps = [
      new Set([`${a}|forward`, `${a}|back`]),
      new Set([`${a}|forward`, `${a}|back`, `${b}|forward`]),
      new Set([`${b}|forward`, `${b}|back`])
    ];
    expect(linePairs(steps)).toEqual(new Set([a]));
  });
});
