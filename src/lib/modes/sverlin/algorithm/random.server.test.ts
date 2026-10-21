import { describe, expect, it } from 'vitest';

import { keyedRandom, seededRandom } from './random.server';

describe('seeded randomness', () => {
  it('gives neighbouring seeds unrelated draws', () => {
    const first = Array.from({ length: 1000 }, (_, seed) => seededRandom(seed + 1, 1)());
    const mean = first.reduce((total, value) => total + value, 0) / first.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    // For independent uniform draws, about 19% of neighbouring pairs fall within 0.1 of each other.
    const close = first.slice(1).filter((value, index) => Math.abs(value - first[index]) < 0.1);
    expect(close.length / (first.length - 1)).toBeGreaterThan(0.14);
    expect(close.length / (first.length - 1)).toBeLessThan(0.24);
  });

  it('generates values in [0, 1) that depend on seed and stream', () => {
    const values = Array.from({ length: 1000 }, seededRandom(9, 1));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRandom(9, 1)()).toBe(values[0]);
    expect(seededRandom(9, 2)()).not.toBe(values[0]);
    expect(seededRandom(10, 1)()).not.toBe(values[0]);
  });

  it('gives each key its own number for a seed, the same every time', () => {
    expect(keyedRandom(3, 'views.Int')).toBe(keyedRandom(3, 'views.Int'));
    expect(keyedRandom(3, 'views.Int')).not.toBe(keyedRandom(3, 'IntCell.fill'));
    expect(keyedRandom(4, 'views.Int')).not.toBe(keyedRandom(3, 'views.Int'));
  });
});
