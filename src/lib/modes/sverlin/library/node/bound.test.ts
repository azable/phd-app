import { describe, expect, it } from 'vitest';

import { boundLength, boundLook, shadesFor, slotAnchor } from './bound';

describe('bound props', () => {
  it('give each value of an unordered domain its own variable’s option', () => {
    const design = { 'Card=true.fill': 'blue-200', 'Card=false.fill': 'neutral-200' };
    const domain = { values: [false, true], ordered: false };
    expect(boundLook(design, 'Card', 'fill', true, domain)).toBe('blue-200');
    expect(boundLook(design, 'Card', 'fill', false, domain)).toBe('neutral-200');
  });

  it('give an ordered domain consecutive options from the first, either way', () => {
    const domain = { values: [0, 1, 2], ordered: true };
    const up = { 'Cell.textSize.from': 16, 'Cell.textSize.order': 'up' };
    expect([0, 1, 2].map((value) => boundLook(up, 'Cell', 'textSize', value, domain))).toEqual([
      16, 18, 20
    ]);
    const down = { ...up, 'Cell.textSize.order': 'down' };
    expect(boundLook(down, 'Cell', 'textSize', 0, domain)).toBe(20);
  });

  it('give an ordered colour the shades of one hue, lightest first', () => {
    const design = { 'Cell.fill.hue': 'teal', 'Cell.fill.order': 'up' };
    const domain = { values: [1, 2, 3], ordered: true };
    expect([1, 2, 3].map((value) => boundLook(design, 'Cell', 'fill', value, domain))).toEqual([
      'teal-100',
      'teal-500',
      'teal-900'
    ]);
    expect(shadesFor(11)).toHaveLength(11);
  });

  it('leave the kind’s own look where the design gives none', () => {
    expect(boundLook({}, 'Card', 'fill', true, { values: [true], ordered: false })).toBeUndefined();
  });

  it('draw a length as the value times its kind’s unit, from zero', () => {
    const design = { 'Bar.height.unit': 16 };
    expect([0, 1, 9].map((value) => boundLength(design, 'Bar', 'height', value))).toEqual([
      0, 16, 144
    ]);
    expect(boundLength({}, 'Bar', 'height', 3)).toBeUndefined();
  });

  it('place a box in its slot by its kind’s anchor, a length standing or from the left until set', () => {
    expect(slotAnchor(undefined, 'y', { height: {} })).toBe('flex-end');
    expect(slotAnchor(undefined, 'x', { width: {} })).toBe('flex-start');
    expect(slotAnchor(undefined, 'x', undefined)).toBe('center');
    expect(slotAnchor('start', 'y', { height: {} })).toBe('flex-start');
    expect(slotAnchor('end', 'x', undefined)).toBe('flex-end');
  });
});
