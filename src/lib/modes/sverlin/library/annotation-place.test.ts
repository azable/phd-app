import { describe, expect, it } from 'vitest';

import { badgeAt, badgeSize, cardPlacement, commentAnchor, unionBox } from './annotation-place';

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height
});
const room = box(0, 0, 1000, 600);
const card = { width: 200, height: 100 };

describe('a comment’s anchor', () => {
  const boxes: Record<string, ReturnType<typeof box>> = {
    a: box(100, 100, 50, 20),
    b: box(300, 40, 20, 200)
  };
  const boxOf = (id: string) => boxes[id];

  it('is the box round every element it is on', () => {
    expect(unionBox([boxes.a!, boxes.b!])).toEqual(box(100, 40, 220, 200));
    expect(commentAnchor({ elements: ['a', 'b'] }, boxOf)).toEqual({
      boxes: [boxes.a, boxes.b],
      box: box(100, 40, 220, 200)
    });
  });

  it('keeps to the elements the step draws, and is nowhere where it draws none', () => {
    expect(commentAnchor({ elements: ['gone', 'a'] }, boxOf)).toEqual({
      boxes: [boxes.a],
      box: boxes.a
    });
    expect(commentAnchor({ elements: ['gone'], point: { x: 5, y: 5 } }, boxOf)).toBeUndefined();
  });

  it('is its point where it is on no element', () => {
    expect(commentAnchor({ point: { x: 5, y: 7 } }, boxOf)).toEqual({
      boxes: [],
      box: box(5, 7, 0, 0)
    });
    expect(commentAnchor({}, boxOf)).toBeUndefined();
  });
});

describe('a comment’s badge', () => {
  it('sits just outside the top right corner, covering none of the elements', () => {
    const anchor = box(100, 100, 50, 20);
    const at = badgeAt(anchor, room);
    expect(at.x).toBeGreaterThanOrEqual(150);
    expect(at.y + badgeSize).toBeLessThanOrEqual(100);
  });

  it('stays inside the canvas', () => {
    expect(badgeAt(box(980, 0, 20, 20), room)).toEqual({ x: 1000 - badgeSize, y: 0 });
  });
});

describe('a comment’s card', () => {
  it('opens on the side with the most room, outside the elements', () => {
    expect(cardPlacement(box(50, 250, 100, 50), card, room)).toMatchObject({
      side: 'right',
      left: 162,
      top: 250
    });
    expect(cardPlacement(box(850, 250, 100, 50), card, room)).toMatchObject({
      side: 'left',
      left: 638
    });
    expect(cardPlacement(box(0, 20, 1000, 50), card, room)).toMatchObject({
      side: 'below',
      top: 82
    });
    expect(cardPlacement(box(0, 450, 1000, 100), card, room)).toMatchObject({
      side: 'above',
      top: 338
    });
  });

  it('stays inside the room along the side it opens on', () => {
    const placed = cardPlacement(box(50, 560, 100, 30), card, room);
    expect(placed.side).toBe('right');
    expect(placed.top).toBe(500);
  });

  it('is joined to the elements’ box by a leader line from its nearest edge', () => {
    const placed = cardPlacement(box(50, 250, 100, 50), card, room);
    expect(placed.from).toEqual({ x: 150, y: 300 });
    expect(placed.to).toEqual({ x: 162, y: 300 });
  });
});
