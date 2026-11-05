import { describe, expect, it } from 'vitest';

import bfs from './fixtures/bfs-captions.sverlin?raw';
import search from './fixtures/search-places.sverlin?raw';
import { pausingEveryLabel } from './testing/every-pause';
import { drawnSteps } from './testing/scenes';

// The same choices with their keys as variants have always stored them, and as written.
const cases = [
  {
    name: 'a place and the listing (search-places)',
    source: search,
    kept: {
      'IntCell@target.stroke': 'violet-500',
      'Arrow.Pointed@lo.fill': 'sky-100',
      'listing.places': 'fill'
    },
    written: {
      'IntCell:target.stroke': 'violet-500',
      'Arrow.Pointed:lo.fill': 'sky-100',
      '<Listing>.places': 'fill'
    }
  },
  {
    name: 'a value of the data (bfs-captions)',
    source: bfs,
    kept: { 'VertexCard.fill@true': 'teal-100', 'VertexCard.fill@false': 'white' },
    written: { 'VertexCard=true.fill': 'teal-100', 'VertexCard=false.fill': 'white' }
  }
];

describe('design keys written or kept', () => {
  it.each(cases)('draw $name alike either way', async ({ source, kept, written }) => {
    const paced = pausingEveryLabel(source);
    const before = await drawnSteps(paced, { chosen: kept });
    const after = await drawnSteps(paced, { chosen: written });
    expect(after.built.warnings ?? []).toEqual(before.built.warnings ?? []);
    expect(JSON.stringify({ frame: after.frame, steps: after.steps })).toBe(
      JSON.stringify({ frame: before.frame, steps: before.steps })
    );
    // The choice changed the picture, so the two forms were read, not both left out.
    const plain = await drawnSteps(paced);
    expect(JSON.stringify(plain.steps)).not.toBe(JSON.stringify(before.steps));
  });
});
