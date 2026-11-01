import { describe, expect, it } from 'vitest';

import { differingSteps, nearestDifference, stepRanges, stepRuns } from './differing-steps';

describe('differing steps', () => {
  it('finds the steps whose keys differ, and none it can tell where a side has no keys', () => {
    expect(differingSteps(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'])).toEqual([1, 2]);
    expect(differingSteps(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(differingSteps(['a', 'b'], undefined)).toBeUndefined();
    expect(differingSteps(['a', 'b'], ['a'])).toBeUndefined();
  });

  it('names steps from 1, in runs', () => {
    expect(stepRuns([8, 2, 3, 4])).toEqual([
      [2, 4],
      [8, 8]
    ]);
    expect(stepRanges([2, 3, 4, 8])).toBe('3–5 and 9');
    expect(stepRanges([0, 2, 5, 6])).toBe('1, 3, and 6–7');
  });

  it('finds the nearest difference either way', () => {
    expect(nearestDifference([2, 3, 8], 3, 1)).toBe(8);
    expect(nearestDifference([2, 3, 8], 3, -1)).toBe(2);
    expect(nearestDifference([2, 3, 8], 8, 1)).toBeUndefined();
    expect(nearestDifference([2, 3, 8], 2, -1)).toBeUndefined();
  });
});
