import { describe, expect, it } from 'vitest';

import { packStates, unpackStates } from './trace-pack';

describe('packed states', () => {
  it('keep shared values once and repeated ones by index, unpacking to the states as built', () => {
    const design = { 'Cell.fill': 'amber-100', 'frame.ratio': '16:9' };
    const states = [
      { i: 0, __design: design, __types: { i: 'Index' }, __absent: [] },
      { i: 1, __design: design, __types: { i: 'Index' }, __absent: ['j'] },
      { i: 1, j: 0, __design: design, __types: { i: 'Index', j: 'Index' }, __absent: [] }
    ];
    const packed = packStates(states);
    expect(packed.shared).toEqual({ __design: design });
    expect(packed.tables.__types).toEqual([{ i: 'Index' }, { i: 'Index', j: 'Index' }]);
    expect(packed.states[1]).toEqual({ i: 1, __types: 0, __absent: 1 });
    expect(unpackStates(packed)).toEqual(states);
  });
});
