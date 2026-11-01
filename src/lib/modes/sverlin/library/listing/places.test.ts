import { describe, expect, it } from 'vitest';

import { colourCss } from '../node/design';
import type { ShownListing } from '../type-context';
import { lightOf, namedPlaces, nodeLight } from './places';

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
    // Without lit places, as with listing.places none, nothing counts.
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
