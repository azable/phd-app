import { describe, expect, it } from 'vitest';

import type { MasterStep, SpanRecord } from './algorithm/interpret.server';
import { selectsOf, withSelectRows } from './selects.server';

describe('query rows', () => {
  it("keeps where a row's positions point: a top-level collection, or the row's own copy of the call's", () => {
    const { selects } = selectsOf('<Select name="calls" from="@f" max="2" />');
    const record: SpanRecord = {
      label: 'f',
      ordinal: 1,
      started: 1,
      ended: 3,
      depth: 0,
      before: {
        state: { values: [4, 2], scratch: [0, 0], lo: 1, k: 0 },
        types: { lo: 'Index', k: 'ScratchIndex' },
        targets: { lo: 'values', k: 'scratch' },
        identities: { ids: { values: 1, 'values[0]': 2, lo: 5 }, copies: {}, refs: {} }
      }
    };
    const step: MasterStep = {
      stop: 2,
      state: { values: [4, 2] },
      types: {},
      identities: { ids: { values: 1, 'values[0]': 2 }, copies: { 9: 2 }, refs: {} }
    };
    const [row] = withSelectRows([step], [record], selects, new Set(['values']));
    expect(row.targets).toEqual({ 'calls[0].lo': 'values', 'calls[0].k': 'calls[0].scratch' });
    // Its values are the same values as where the record held them, so they move as those do.
    expect(row.identities).toEqual({
      ids: {
        values: 1,
        'values[0]': 2,
        'calls[0].values': 1,
        'calls[0].values[0]': 2,
        'calls[0].lo': 5
      },
      copies: { 9: 2 },
      refs: {}
    });
  });
});
