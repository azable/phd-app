import { describe, expect, it } from 'vitest';

import * as v from 'valibot';

import {
  arrangementSchema,
  arrangementsText,
  layoutShape,
  readabilityText,
  type Readability
} from './readability';

const wide: Readability = {
  ratio: '16:9',
  frame: { width: 1200, height: 675 },
  content: { width: 960, height: 400 },
  parts: [
    { width: 600, height: 400 },
    { width: 340, height: 400 }
  ],
  row: true,
  scale: 0.77,
  text: 12,
  smallest: 10,
  fill: 0.38
};

describe('the layout shape told with each version', () => {
  it('gives its aspect ratio, how much of its frame it fills and its parts first', () => {
    expect(layoutShape(wide)).toBe('2.4:1 wide, filling 38% of its frame, 2 parts side by side');
    expect(readabilityText(wide)).toMatch(
      /^Layout 2\.4:1 wide, filling 38% of its frame, 2 parts side by side\. On a typical stage/u
    );
  });

  it('names a tall content by its height, and reads a build stored before the fill was', () => {
    const older = { ...wide, content: { width: 300, height: 600 }, parts: [], fill: undefined };
    expect(layoutShape(older)).toBe('1:2 tall, 1 part');
  });
});

describe('the arrangements told with a version', () => {
  const arrangement = (seed: number, fill: number, crossings: number, text = 12) => ({
    values: { 'Graph.layoutSeed': seed },
    readability: { ...wide, fill, text },
    crossings
  });

  it('ranks readable text first, then a fuller frame with fewer crossings, one line each', () => {
    const lines = arrangementsText([
      { ...arrangement(1, 0.5, 2), shown: true },
      arrangement(2, 0.7, 0),
      arrangement(3, 0.9, 0, 5)
    ]);
    expect(lines).toEqual([
      'Graph.layoutSeed 2: 2.4:1 wide, filling 70% of its frame, 2 parts side by side, 0 crossings, text 12 px',
      'Graph.layoutSeed 1: 2.4:1 wide, filling 50% of its frame, 2 parts side by side, 2 crossings, text 12 px (shown)',
      'Graph.layoutSeed 3: 2.4:1 wide, filling 90% of its frame, 2 parts side by side, 0 crossings, text 5 px'
    ]);
  });

  it('tells one measuring alike once, the shown one first, and at most five', () => {
    const others = Array.from({ length: 8 }, (_, k) => arrangement(k + 2, 0.5 + k / 100, 0));
    const lines = arrangementsText([
      arrangement(1, 0.4, 0),
      { ...arrangement(10, 0.4, 0), shown: true },
      ...others
    ]);
    expect(lines).toHaveLength(5);
    expect(
      arrangementsText([arrangement(1, 0.4, 0), { ...arrangement(10, 0.4, 0), shown: true }])
    ).toEqual([expect.stringContaining('Graph.layoutSeed 10')]);
  });

  it('reads a presentation stored before arrangements were', () => {
    expect(v.safeParse(arrangementSchema, arrangement(1, 0.5, 0)).success).toBe(true);
    expect(v.safeParse(v.optional(v.array(arrangementSchema)), undefined).success).toBe(true);
  });
});
