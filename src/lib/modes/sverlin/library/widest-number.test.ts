import { describe, expect, it } from 'vitest';

import { widestInteger } from './widest-number';

// A proportional font's digits: 1 narrow, 8 widest, the others between. Ties go to the first value.
const proportional = (character: string) => ({ '1': 4, '8': 9, '-': 5 })[character] ?? 7;
const tabular = () => 7;

describe('widestInteger', () => {
  it('takes the most digits when every digit is as wide', () => {
    expect(widestInteger(0, 250, tabular)).toBe(100);
    expect(widestInteger(-5, 9, tabular)).toBe(-5);
  });

  it('finds the widest number within the range in a proportional font', () => {
    expect(widestInteger(0, 250, proportional)).toBe(208);
    expect(widestInteger(0, 1000, proportional)).toBe(888);
    expect(widestInteger(-120, 50, proportional)).toBe(-108);
  });

  it('searches ranges too large to try every value by their candidates', () => {
    expect(widestInteger(0, 2_500_000, proportional)).toBe(2_088_888);
    expect(widestInteger(-2_500_000, 0, proportional)).toBe(-2_088_888);
  });
});
