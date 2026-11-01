import { describe, expect, it } from 'vitest';

import { fittedHeight, neededFit } from './fit';

describe('a frame taking the shape of its content', () => {
  const shapes = { widest: 16 / 9, tallest: 9 / 16 };
  const padding = { width: 48, height: 48 };

  it('is as tall as its content at the fit its width allows, with its padding', () => {
    // 1152 inside, so content 960 wide is scaled up by 1.2, and its 700 to 840.
    expect(fittedHeight(1200, padding, { width: 960, height: 700 }, shapes)).toBe(888);
    // Small content is scaled up no more than any frame scales it.
    expect(neededFit({ width: 1152, height: Infinity }, { width: 200, height: 300 })).toBe(1.6);
    expect(fittedHeight(1200, padding, { width: 200, height: 500 }, shapes)).toBe(848);
  });

  it('is kept between the widest and the tallest shapes', () => {
    expect(fittedHeight(1200, padding, { width: 1152, height: 100 }, shapes)).toBe(675);
    expect(fittedHeight(1200, padding, { width: 300, height: 3000 }, shapes)).toBeCloseTo(
      1200 / (9 / 16),
      5
    );
  });
});
