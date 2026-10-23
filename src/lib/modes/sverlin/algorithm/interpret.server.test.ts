import { describe, expect, it } from 'vitest';

import {
  algorithmLimits,
  interpretAlgorithm as interpretTyped,
  interpretDomain,
  interpretInput as interpretTypedInput,
  type TypedState
} from './interpret.server';

// Input and algorithm values all have domain types; these tests share a small domain.
const atoms = interpretDomain(
  "const Int = type('integer', { min: -100, max: 1000 }); const Real = type('number', { min: -100, max: 1000 }); const Flag = type('boolean'); const Text = type(['x', 'pair', 'yes']); const Ints = collection(Int); const Reals = collection(Real); const Grid = collection(Ints); const Point = record({ x: Int, y: Int });"
);
const interpretAlgorithm = (body: string, input?: TypedState) => interpretTyped(body, input, atoms);
const interpretInput = (body: string) => interpretTypedInput(body, atoms);
const plain = <T extends { types: unknown }>(step: T) => ({
  ...step,
  types: undefined,
  identities: undefined,
  events: undefined,
  counts: undefined,
  moment: undefined,
  before: undefined,
  gap: undefined
});

describe('algorithm interpretation', () => {
  it('records every top-level binding at each step', () => {
    // The last step holds what runs after the last labelled code: the loop's exit.
    const trace = interpretAlgorithm(`
      const values = Ints([3, 8, 5]);
      let i = Int(-1);
      let found = Flag(false); // @step
      i = Int(0);
      while (i < values.length) {
        if (values[i] === 8) { // @step
          found = Flag(true);
          break;
        }
        i++;
      }
    `);
    expect(trace.map(({ state }) => state.i)).toEqual([-1, 0, 1, 1]);
    expect(trace[0].state).toEqual({ values: [3, 8, 5], i: -1, found: false });
    expect(trace[3].state).toEqual({ values: [3, 8, 5], i: 1, found: true });
  });

  it('snapshots state so later mutations do not change earlier steps', () => {
    const trace = interpretAlgorithm(`
      const a = Ints([2, 1]); // @step
      const t = a[0]; a[0] = a[1]; a[1] = t; // @step
    `);
    expect(trace[0].state.a).toEqual([2, 1]);
    expect(trace[1].state.a).toEqual([1, 2]);
    expect(trace[0].state).not.toHaveProperty('t');
  });

  it('supports loops, objects, array methods, Math, and early return', () => {
    const trace = interpretAlgorithm(`
      const stack = Reals([]);
      const point = Point({ x: 1, y: 2 });
      let total = Int(0);
      for (const n of Ints([4, 9, 16])) { stack.push(Math.sqrt(n)); total += n; }
      let k = Int(0);
      while (true) { k++; if (k > 2) break; else continue; }
      point.x += stack.indexOf(3);
      let i = Int(0);
      const a = Ints([0, 0]);
      a[i++] += 5;
      const joined = Int(stack.join('-').length);
      return;
    `);
    expect(trace.map(plain)).toEqual([
      {
        state: {
          stack: [2, 3, 4],
          point: { x: 2, y: 2 },
          total: 29,
          k: 3,
          i: 1,
          a: [5, 0],
          joined: 5
        },
        types: undefined
      }
    ]);
  });

  it.each([
    ['nested functions', 'if (true) { function f() {} }', /at the top level/],
    ['arrow functions', 'const f = () => 1;', /Functions are not supported here/],
    ['global access', 'const w = globalThis;', /"globalThis" is not defined/],
    ['constructor escapes', 'const a = Ints([]); const c = a.constructor;', /not allowed/],
    ['prototype keys', 'const o = Point({ x: 1, y: 2 }); o["__proto__"] = 1;', /not allowed/],
    [
      'host methods',
      'const s = Text("x"); const t = Text(s.repeat(3));',
      /only available on arrays/
    ],
    ['new', 'const d = new Date();', /New Expression/],
    ['loose equality', 'const f = Flag(1 == 1);', /Use ===/],
    ['reserved names', 'let step = Int(0);', /reserved/],
    ['undeclared assignment', 'x = Int(1);', /must be declared/],
    ['yield', 'yield;', /Steps are marked by labels, not yield/],
    ['nested yield', 'const a = Ints([yield]);', /Steps are marked by labels, not yield/],
    [
      'object arithmetic',
      'const o = Point({ x: 1, y: 2 }); const n = Int(o - 1);',
      /Expected a number/
    ],
    ['plain arrays', 'const a = [Int(1)];', /Arrays are made by a collection type/],
    ['plain objects', 'const o = { x: Int(1) };', /Objects are made by a record type/]
  ])('rejects %s', (_name, body, message) => {
    expect(() => interpretAlgorithm(body)).toThrow(message);
  });

  it('stops endless loops and oversized state', () => {
    expect(() => interpretAlgorithm('while (true) {}')).toThrow(/operations/);
    expect(() =>
      interpretAlgorithm(
        `let a = Ints([1]); while (a.length < 200) a.push(1); const n = Int(a.join("${'-'.repeat(60)}").length);`
      )
    ).toThrow(/characters/);
    expect(() =>
      interpretAlgorithm('let a = Ints([1]); while (true) { a = Ints([...a, ...a]); }')
    ).toThrow(/entries/);
    expect(() =>
      interpretAlgorithm(
        'let a = Ints([1]); for (let i = Int(0); i < 13; i++) a = Ints([...a, ...a]); for (let j = Int(0); j < 30; j++) {} // @step'
      )
    ).toThrow(/too large/);
    expect(() =>
      interpretAlgorithm(
        `for (let i = Int(0); i <= ${algorithmLimits.maximumSteps}; i++) {} // @step`
      )
    ).toThrow(/more than/);
  });

  it('gives an algorithm without labels one step, its end', () => {
    const trace = interpretAlgorithm('let x = Int(1); x++;');
    expect(trace.map(({ state }) => state)).toEqual([{ x: 2 }]);
  });

  it('reports offsets into the algorithm body', () => {
    const body = 'let x = Int(1);\nx = y;';
    expect(() => interpretAlgorithm(body)).toThrow(
      expect.objectContaining({ offset: body.indexOf('y;') })
    );
    expect(() => interpretAlgorithm('let x = ;')).toThrow(
      expect.objectContaining({ name: 'AlgorithmError', offset: 8 })
    );
  });
});

describe('input and step selection', () => {
  it('starts the algorithm from the input and records input variables', () => {
    const input = interpretInput('const values = Ints([2, 1]); const label = Text("pair");');
    const trace = interpretAlgorithm(
      '/* @step */ values.reverse(); let swapped = Flag(true);',
      input
    );
    expect(trace[0].before?.state).toEqual({ values: [2, 1], label: 'pair' });
    expect(trace.map(({ state }) => state)).toEqual([
      { values: [1, 2], label: 'pair' },
      { values: [1, 2], label: 'pair', swapped: true }
    ]);
    expect(input.state.values).toEqual([2, 1]);
    expect(() => interpretAlgorithm('let values = Ints([]);', input)).toThrow(
      /already declared here or in the input/
    );
    expect(() => interpretInput('const x = Int(1); yield;')).toThrow(
      /Steps are marked by labels, not yield/
    );
  });

  it('has no design draws', () => {
    expect(() => interpretAlgorithm('const a = pick([1]);')).toThrow(/not available/);
  });
});

describe('domain types', () => {
  it('rejects plain values in the input, naming where they are and how to type them', () => {
    expect(() => interpretInput('const n = 8;')).toThrow(
      'n would be the plain number 8, but input and algorithm values must have a domain type. Write it as Int(8) or Real(8)'
    );
    expect(() => interpretTypedInput('const n = 3;')).toThrow(
      "Declare a type that says what it means in the domain block, such as const Count = type('integer', { min: 0, max: 9 });, and write Count(3)."
    );
    // Collections and records made by their types are fine.
    expect(interpretInput('const empty = Ints([]); const grid = Grid([[1]]);').state).toEqual({
      empty: [],
      grid: [[1]]
    });
  });

  it('rejects plain values the algorithm stores, at the statement that stores them', () => {
    expect(() => interpretAlgorithm('let i = 0;')).toThrow(/i would be the plain number 0/);
    expect(() => interpretAlgorithm('const s = Ints([]); s.push("x");')).toThrow(
      /an item added by s\.push\(\): Int values must be whole numbers, not "x"/
    );
    // Plain literals in expressions are fine when the result keeps its type.
    expect(interpretAlgorithm('let i = Int(0); i = i + 1; i += 2; i++;')[0].types).toEqual({
      i: 'Int'
    });
  });

  it('keeps each variable the type it was made with, converting what is assigned to it', () => {
    const step = interpretAlgorithm(
      'const d = Ints([0, 1]); let n = Int(0); n = d.length; let found = Flag(false); found = 1 < 2;'
    )[0];
    expect(step.state).toMatchObject({ n: 2, found: true });
    expect(step.types).toMatchObject({ n: 'Int', found: 'Flag' });
    const body = 'let found = Flag(false);\nfound = Text("yes");';
    expect(() => interpretAlgorithm(body)).toThrow(
      expect.objectContaining({
        offset: body.indexOf('found = Text'),
        message: expect.stringMatching(/^found must be a Flag, not a Text/u)
      })
    );
    expect(() => interpretAlgorithm('let h = Int(7); h = h / Int(2);')).toThrow(
      /h: Int values must be whole numbers, not 3\.5/
    );
  });

  it('has no null: every place holds a value of its type', () => {
    expect(() => interpretInput('const none = null;')).toThrow(/There is no null/);
    expect(() => interpretAlgorithm('let x;')).toThrow(/Give x a starting value/);
    expect(() => interpretAlgorithm('const s = Ints([]); const x = s.pop();')).toThrow(
      /x would have no value: it was taken from an empty collection/
    );
    expect(() => interpretAlgorithm('const s = Ints([]); let x = Int(0); x = s.pop();')).toThrow(
      /x would have no value.*an Int is needed here|x would have no value/
    );
    expect(() => interpretAlgorithm('const x = undefined;')).toThrow(/"undefined" is not defined/);
  });
});
