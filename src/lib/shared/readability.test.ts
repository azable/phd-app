import { describe, expect, it } from 'vitest';

import { layoutShape, readabilityText, type Readability } from './readability';

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
