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
  "const Int = type('integer', { min: -100, max: 1000 }); const Real = type('number', { min: -100, max: 1000 }); const Flag = type('boolean'); const Text = type(['x', 'pair', 'yes']); const Ints = collection(Int); const Reals = collection(Real); const Grid = collection(Ints); const Point = record({ x: Int, y: Int });" +
    // The algorithm computes nothing itself: these are its operators.
    `const Less = binop((a: Int, b: Int) => Flag(a < b));
    const Equal = binop((a: Int, b: Int) => Flag(a === b));
    const Add = binop((a: Int, b: Int) => Int(a + b));
    const Next = unop((n: Int) => Int(n + 1));
    const Count = unop((v: Ints) => Int(v.length));
    const Root = unop((n: Int) => Real(Math.sqrt(n)));
    const Width = unop((v: Reals) => Int(v.join('-').length));
    const Halve = unop((n: Int) => Real(n / 2));
    const Long = unop((v: Ints) => Int(v.join('${'-'.repeat(60)}').length));
    const Push = binop((c: Reals, x: Real) => Reals([...c, x]));
    const Find = binop((c: Reals, x: Real) => Int(c.indexOf(x)));
    const Grow = binop((c: Ints, x: Int) => Ints([...c, x]));
    const Flip = unop((c: Ints) => Ints(c.slice().reverse()));`
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
  gap: undefined,
  seen: undefined,
  trail: undefined,
  name: undefined
});

describe('algorithm interpretation', () => {
  it('records every top-level binding at each step', () => {
    // A label with a run changing a variable pauses at each of its runs: the check finding nothing
    // is a step too, as the check finding 8 makes @check a pause.
    const trace = interpretAlgorithm(`
      @start[const values = Ints([3, 8, 5]);
      let i = Int(-1);
      let found = Flag(false);]
      @first[i = Int(0);]
      while (Less(i, Count(values))) {
        @check[if (Equal(values[i], 8)) {
          found = Flag(true);
          break;
        }]
        @next[i = Next(i);]
      }
    `);
    expect(trace.map(({ state }) => state.i)).toEqual([-1, 0, 0, 1, 1]);
    expect(trace[0].state).toEqual({ values: [3, 8, 5], i: -1, found: false });
    expect(trace[4].state).toEqual({ values: [3, 8, 5], i: 1, found: true });
  });

  it('snapshots state so later mutations do not change earlier steps', () => {
    const trace = interpretAlgorithm(`
      @start[const a = Ints([2, 1]);]
      @swap[const t = a[0]; a[0] = a[1]; a[1] = t;]
    `);
    expect(trace[0].state.a).toEqual([2, 1]);
    expect(trace[1].state.a).toEqual([1, 2]);
    expect(trace[0].state).not.toHaveProperty('t');
  });

  it('supports loops, objects, array methods, operators, and early return', () => {
    const trace = interpretAlgorithm(`
      let stack = Reals([]);
      const point = Point({ x: 1, y: 2 });
      let total = Int(0);
      for (const n of Ints([4, 9, 16])) { stack = Push(stack, Root(n)); total = Add(total, n); }
      let k = Int(0);
      while (true) { k = Next(k); if (Less(2, k)) break; else continue; }
      point.x = Add(point.x, Find(stack, 3));
      let i = Int(0);
      const a = Ints([0, 0]);
      a[i] = Add(a[i], 5);
      i = Next(i);
      const joined = Width(stack);
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
    ['arrow functions', 'const f = () => 1;', /Arrow functions are only an operator’s function/],
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
    ['undeclared assignment', 'x = Int(1);', /must be declared/],
    [
      'object arithmetic',
      'const o = Point({ x: 1, y: 2 }); const n = Int(o - 1);',
      /- on Point and Int/
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
        'let a = Ints([1]); while (Less(Count(a), 200)) a = Grow(a, 1); const n = Long(a);'
      )
    ).toThrow(/characters/);
    expect(() =>
      interpretAlgorithm('let a = Ints([1]); while (true) { a = Ints([...a, ...a]); }')
    ).toThrow(/entries/);
    expect(() =>
      interpretAlgorithm(
        '@grow[let a = Ints([1]); for (let i = Int(0); Less(i, 13); i = Next(i)) a = Ints([...a, ...a]);\nlet b = Int(0);] @loop[for (let j = Int(0); Less(j, 30); j = Next(j)) { b = Next(j); }]'
      )
    ).toThrow(/too large/);
    expect(() =>
      interpretAlgorithm(
        `let n = Int(0); @loop[for (let i = Int(0); Less(i, ${algorithmLimits.maximumSteps + 1}); i = Next(i)) { n = Next(i); }]`
      )
    ).toThrow(/more than/);
  });

  it('gives an algorithm without labels one step, its end', () => {
    const trace = interpretAlgorithm('let x = Int(1); x = Next(x);');
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
      '@reverse[values = Flip(values);] @flag[let swapped = Flag(true);]',
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
    expect(() => interpretAlgorithm('let s = Ints([]); s = Grow(s, "x");')).toThrow(
      /Int values must be whole numbers, not "x"/
    );
    // A plain literal given to an operator takes its operand's type.
    expect(interpretAlgorithm('let i = Int(0); i = Add(i, 1); i = Next(i);')[0].types).toEqual({
      i: 'Int'
    });
  });

  it('keeps each variable the type it was made with, converting what is assigned to it', () => {
    const step = interpretAlgorithm(
      'const d = Ints([0, 1]); let n = Int(0); n = Count(d); let found = Flag(false); found = Less(1, 2);'
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
    expect(() => interpretAlgorithm('let h = Int(7); h = Halve(h);')).toThrow(
      /h must be a Int, not a Real/
    );
  });

  it('has no null: every place holds a value of its type', () => {
    expect(() => interpretInput('const none = null;')).toThrow(/There is no null/);
    expect(() => interpretAlgorithm('let x;')).toThrow(/Give x a starting value/);
    expect(() => interpretAlgorithm('const s = Ints([]); const x = s[0];')).toThrow(/s\[0\]/);
    expect(() => interpretAlgorithm('const x = undefined;')).toThrow(/"undefined" is not defined/);
  });
});
