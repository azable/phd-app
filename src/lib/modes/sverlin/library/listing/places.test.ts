import { describe, expect, it } from 'vitest';

import { colourCss } from '../node/design';
import type { ShownListing } from '../type-context';
import { contrast } from '../colour';
import { lightOf, lineColour, lineContrast, namedPlaces, nodeLight } from './places';

const listing: ShownListing = {
  text: 'lo <= hi',
  regions: [],
  lit: [],
  places: {
    look: 'fill',
    tokens: [
      { place: '@lo', start: 0, end: 2 },
      { place: '@hi', start: 6, end: 8 }
    ],
    paints: { '@lo': 'sky-200', '@hi': 'violet-200' }
  },
  touched: ['@hi']
};

describe('a place’s references in the picture', () => {
  it('count only places a token names, once each', () => {
    expect(namedPlaces(listing, ['@hi', undefined, '@v', '@hi', '@lo'])).toEqual(['@hi', '@lo']);
    // Without lit places, as with <Listing>.places none, nothing counts.
    expect(namedPlaces({ ...listing, places: undefined }, ['@hi'])).toEqual([]);
  });

  it('light in the colour of a place the step touches, taking no room', () => {
    expect(lightOf(listing, ['@lo'])).toBeUndefined();
    expect(lightOf(listing, ['@lo', '@hi'])).toBe(colourCss('violet-200'));
    const colour = colourCss('violet-200') as string;
    expect(nodeLight('fill', colour)).toEqual({ shadow: `0 0 0 3px ${colour}` });
    expect(nodeLight('outline', colour)).toEqual({
      outline: `2px solid ${colour}`,
      outlineOffset: '3px'
    });
    expect(nodeLight('underline', colour).shadow).toContain(colour);
  });
});

describe("a place's line", () => {
  it('keeps a colour that shows, and darkens one that does not in its own hue', () => {
    expect(lineColour('violet-500', '#ffffff')).toBe(colourCss('violet-500'));
    expect(lineColour('amber-500', '#ffffff')).toBe(colourCss('amber-600'));
    const pale = lineColour('amber-100', '#ffffff')!;
    expect(pale).toMatch(/ 70\)$/u);
    expect(contrast(pale, '#ffffff')).toBeGreaterThanOrEqual(lineContrast);
    // A transparent page is the white behind it.
    expect(lineColour('amber-500', 'rgba(0, 0, 0, 0)')).toBe(colourCss('amber-600'));
  });

  it('lightens on a dark page, takes black or white where no shade shows, and has none for none', () => {
    const dark = colourCss('neutral-900')!;
    const line = lineColour('blue-800', dark)!;
    expect(line).toMatch(/ 260\)$/u);
    expect(contrast(line, dark)).toBeGreaterThanOrEqual(lineContrast);
    expect(lineColour('white', '#ffffff')).toBe('#000000');
    expect(lineColour('none', '#ffffff')).toBeUndefined();
  });
});
