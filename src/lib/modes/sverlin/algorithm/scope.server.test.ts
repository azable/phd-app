import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Table = collection(Values);
  const RowIndex = index(Table);
`);
const run = (body: string) => interpretAlgorithm(body, undefined, domain);

describe('scope', () => {
  it('records the variables in scope at each step, and none out of it', () => {
    const trace = run(`
      const values = Values([3, 1]); // @step
      for (let i = Position(0); i < values.length; i++) {
        const seen = values[i]; // @step
      }
      let done = Int(1); // @step
    `);
    expect(trace.map(({ state }) => Object.keys(state))).toEqual([
      ['values'],
      ['values', 'i', 'seen'],
      ['values', 'i', 'seen'],
      ['values', 'done']
    ]);
    expect(trace[1].types).toMatchObject({ i: 'Position', seen: 'Int' });
    expect(trace[1].targets).toEqual({ i: 'values' });
  });

  it('lets loops one after another each declare a name, and no block hide one in scope', () => {
    expect(() =>
      run(`const values = Values([1]);
           for (let j = Position(0); j < 1; j++) {}
           for (let j = Position(0); j < 1; j++) {}`)
    ).not.toThrow();
    expect(() =>
      run(`const values = Values([1]);
           for (let j = Position(0); j < 1; j++) { for (let j = Position(0); j < 1; j++) {} }`)
    ).toThrow('"j" is already declared in an enclosing block or loop; give this one another name');
    expect(() => run(`let n = Int(1); { const n = Int(2); }`)).toThrow(
      '"n" is already declared in the top level or the input block'
    );
  });

  it('points a position into a collection a block holds', () => {
    const [step] = run(`
      const paths = Table([[1, 2], [3, 4]]);
      for (let r = RowIndex(0); r < 1; r++) {
        const row = paths[r];
        let c = Position(row, 1); // @step
      }
    `);
    expect(step.targets).toMatchObject({ c: 'row' });
    expect(step.identities?.ids.row).toBe(step.identities?.ids['paths[0]']);
  });
});
