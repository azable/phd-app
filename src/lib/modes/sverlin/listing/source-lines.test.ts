import { describe, expect, it } from 'vitest';

import { locateElement } from '../element-ref';
import { readRegions } from './mapped.server';
import { listingLine, shownLineGroups } from './source-lines';

const body = `
  SORT(A)
  @pass[
  for each pass
      @pair[compare A[j] and A[j + 1]
      ]
  ]
  done
`;

describe('the lines a listing shows', () => {
  it('joins a line of openings to the next and a line of closings to the one before', () => {
    expect(shownLineGroups(body)).toEqual([[1], [2, 3], [4, 5, 6], [7]]);
  });

  it('shows as many lines as readRegions draws', () => {
    expect(shownLineGroups(body)).toHaveLength(readRegions(body).text.split('\n').length);
  });
});

const source = `<script algorithm>
  function sort(values) {
    for (let p = 0; @more[p < 2]; p++) @pass{
      for (let j = 0; @inner[j < 1]; j++) @pair{
        if (@test[values[j] > values[j + 1]]) {}
      }
    }
  }
</script>

<script listing="textbook">
SORT(A)
@pass[for each pass
    @pair[@test[if A[j] > A[j + 1]]: swap]
]
</script>

<script listing="plain">
@more[while not sorted]
</script>

<Layout name="Main"><Listing /></Layout>`;

describe('a listing line in its source', () => {
  it('names its source lines and the labels round it by their full names, outermost first', () => {
    expect(listingLine(source, 3)).toEqual({
      name: 'textbook',
      // The closing line after it, ] alone, joins it.
      lines: { first: 14, last: 15 },
      labels: ['pass', 'pass.pair', 'pass.pair.test']
    });
  });

  it('is found in the listing the presentation shows', () => {
    expect(listingLine(source, 1, 'plain')).toEqual({
      name: 'plain',
      lines: { first: 19, last: 19 },
      labels: ['more']
    });
  });

  it('is part of where a selected listing line is, for the assistant', () => {
    const tag = source.split('\n').findIndex((line) => line.includes('<Listing'));
    const column = source.split('\n')[tag].indexOf('<Listing') + 1;
    expect(locateElement(source, `${tag + 1}:${column}@L2`)?.listing).toEqual({
      name: 'textbook',
      lines: { first: 13, last: 13 },
      labels: ['pass']
    });
  });
});
