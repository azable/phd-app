import { describe, expect, it } from 'vitest';

import insertion from '../fixtures/insertion-decisions.sverlin?raw';
import { drawnSteps } from '../testing/scenes';
import { telltaleSteps, viewAlone } from './crops';
import { scenePictures } from './png.server';

describe('pictures of scenes', () => {
  it('draw a view alone: a few of its values drawn differently, side by side', async () => {
    const { frame, steps } = await drawnSteps(insertion);
    const type = steps.flatMap((step) => step.nodes).find((node) => node.type)?.type;
    expect(type).toBeDefined();
    const alone = viewAlone({ frame, steps }, type!);
    expect(alone?.steps).toHaveLength(1);
    const roots = alone!.steps[0].nodes.filter((node) => node.parent === undefined);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThanOrEqual(4);
    expect(roots.every((node) => node.type === type)).toBe(true);
    expect(roots.every(({ box }) => box.x + box.width <= alone!.frame.width)).toBe(true);
  });

  it('pick the first step, the fullest, and the last', () => {
    const step = (count: number) => ({
      nodes: Array.from({ length: count }, (_, id) => ({ id: String(id) })),
      links: []
    });
    expect(telltaleSteps([step(1), step(5), step(3), step(2)] as never)).toEqual([0, 1, 3]);
    expect(telltaleSteps([step(4)] as never)).toEqual([0]);
  });

  it('turn steps into PNGs at the width they show', async () => {
    const { frame, steps } = await drawnSteps(insertion);
    const pictures = await scenePictures({ frame, steps: steps.slice(0, 2) }, 320);
    expect(pictures).toHaveLength(2);
    expect(pictures.every((picture) => picture.startsWith('data:image/png;base64,'))).toBe(true);
    const png = Buffer.from(pictures[0].split(',')[1], 'base64');
    // The width is the four bytes after the IHDR chunk's type, at offset 16.
    expect(png.readUInt32BE(16)).toBe(320);
  });
});
