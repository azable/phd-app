import { describe, expect, it } from 'vitest';

import type { Readability } from '$lib/shared/readability';
import { arrangementsText } from './arrangements.server';

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

describe('the shape layouts aim at', () => {
  it('ranks a layout near the stage’s 3:2 above a square one filling more, and a tall one last', async () => {
    const { rankedArrangements } = await import('./arrangements.server');
    const shaped = (width: number, height: number, fill: number) => ({
      values: { 'Graph.form': `${width}x${height}` },
      crossings: 0,
      readability: { ...wide, content: { width, height }, fill }
    });
    const ranked = rankedArrangements([
      shaped(600, 1800, 0.9),
      shaped(800, 800, 0.85),
      shaped(960, 640, 0.6)
    ]);
    expect(ranked.map(({ values }) => values['Graph.form'])).toEqual([
      '960x640',
      '800x800',
      '600x1800'
    ]);
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
});
