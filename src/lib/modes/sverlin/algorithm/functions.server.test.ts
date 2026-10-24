import { describe, expect, it } from 'vitest';

import { declaredNames, interpretDomain, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Length = unop(Values, (v) => Index(v.length));
  const Before = binop(Index, Index, (a, b) => Flag(a < b));
  const Same = binop(Index, Index, (a, b) => Flag(a === b));
  const Next = unop(Index, (p) => Index(p + 1));
  const Back2 = unop(Index, (p) => Index(p - 2));
  const Equal = binop(Int, Int, (a, b) => Flag(a === b));
  const Below = binop(Int, Int, (a, b) => Flag(a < b));
  const Add = binop(Int, Int, (a, b) => Int(a + b));
  const Up = unop(Int, (n) => Int(n + 1));
  const Triple = unop(Int, (n) => Int(n * 3));
  const Even = unop(Int, (n) => Flag(n % 2 === 0));
  const Short = unop(Values, (v) => Flag(v.length < 3));
`);
const run = (body: string, frames?: string) =>
  traceAlgorithm(body, undefined, domain, frames).steps;

describe('functions', () => {
  it('are called with their arguments, giving back a position into the caller’s collection', () => {
    const [step] = run(`
      function search(a, target) {
        for (let i = Index(0); Before(i, Length(a)); i = Next(i)) if (Equal(a[i], target)) return i;
        return Index(-1);
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(5));
    `);
    expect(step.state.found).toBe(2);
    expect(step.targets).toEqual({ found: 'values' });
  });

  it('record their own variables and the top level’s at a step, under the top level’s names', () => {
    // Each check is a step, and the end another.
    const trace = run(`
      function search(a, target) {
        for (let i = Index(0); Before(i, Length(a)); i = Next(i)) {
          @check[if (Equal(a[i], target)) return i;]
        }
        @miss[return Index(-1);]
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(8));
    `);
    expect(trace.map(({ state }) => Object.keys(state))).toEqual([
      ['values', 'a', 'target', 'i'],
      ['values', 'a', 'target', 'i'],
      ['values', 'found']
    ]);
    expect(trace[1].targets).toMatchObject({ i: 'values' });
  });

  it('hide top-level variables of the same name with their parameters', () => {
    const [inside] = run(`
      function first(values) {
        @step[const v = values[0];]
      }
      const values = Values([4, 2]);
      first(values.slice(1));
    `);
    expect(inside.state).toMatchObject({ values: [2], v: 2 });
  });

  it('recur, each call seeing only its own variables', () => {
    const trace = run(
      `
      function count(a, lo) {
        @test[if (Same(lo, Length(a))) return Int(0);]
        @add[return Add(a[lo], count(a, Next(lo)));]
      }
      const values = Values([3, 8, 5]);
      const total = count(values, Index(0));
    `,
      'test'
    );
    // Each call's test is a step, the innermost's too, where it returns; then the end.
    expect(trace.map(({ state }) => state.lo)).toEqual([0, 1, 2, 3, undefined]);
    expect(trace.at(-1)?.state.total).toBe(16);
  });

  it('read and write the collections given, not the top level’s variables', () => {
    const [step] = run(`
      function bump(a) { for (let i = Index(0); Before(i, Length(a)); i = Next(i)) a[i] = Up(a[i]); }
      const values = Values([1, 2]);
      bump(values);
    `);
    expect(step.state.values).toEqual([2, 3]);
    expect(() =>
      run('function peek() { return values[0]; } const values = Values([1]); peek();')
    ).toThrow('"values" is not defined');
  });

  it.each([
    [
      'arguments of another type than the first call’s',
      'function f(n) { return n; } const a = f(Int(1)); const b = f(Flag(true));',
      "f's n is a Int, as its first call gave it, so it cannot be given a Flag."
    ],
    [
      'too few arguments',
      'function f(a, b) { return a; } const n = f(Int(1));',
      'f takes 2 arguments: a, b.'
    ],
    [
      'plain arguments',
      'function f(n) { return n; } const a = f(3);',
      'n would be the plain number 3'
    ],
    [
      'no value where one is used',
      'function f(n) {} const a = f(Int(1));',
      'f(...) gave no value here: give it one with return'
    ],
    [
      'calls nested without end',
      'function f(n) { return f(n); } const a = f(Int(1));',
      'Calls nest more than 100 deep.'
    ],
    ['generators', 'function* f() {} f();', 'Write function f(...), without * or async'],
    ['a type’s name', 'function Int() {}', '"Int" is taken; give the function another name.'],
    ['destructured parameters', 'function f({ a }) {}', "f's parameters are plain names"],
    ['return values outside them', 'return Int(1);', 'a function can, as in return i;']
  ])('reject %s', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it('declare their parameters as names the view can read', () => {
    expect(
      declaredNames(
        'function f(a, lo) { const m = lo; } f(Values([1]), Index(0));',
        'algorithm',
        domain
      )
    ).toEqual(expect.arrayContaining(['a', 'lo', 'm']));
  });
});

describe('loops', () => {
  it('count up, down, and by a constant step, and skip on with continue', () => {
    const loops = `
      @start[const values = Values([1, 2, 3, 4, 5]);]
      @down[for (let i = Index(4); Before(Index(-1), i); i = Back2(i)) {}]
      for (let j = Index(0); Before(j, Length(values)); j = Next(j)) {
        @skip[if (Even(values[j])) continue;]
        @take[const odd = values[j];]
      }
    `;
    // A labelled loop steps once per pass; the end, with neither in scope, is the last.
    expect(run(loops, 'down').map(({ state }) => state.i)).toEqual([4, 2, 0, undefined]);
    expect(run(loops, 'take').map(({ state }) => state.j)).toEqual([0, 2, 4, undefined]);
  });

  it('take any header: a counter declared outside, changed in the body, or a bound that grows', () => {
    const trace = run(`
      @start[const values = Values([1]);
      let i = Index(0);]
      for (i = Index(0); Before(i, Length(values)); i = Next(i)) {
        @grow[if (Short(values)) values.push(1);]
      }
      for (let k = Int(1); Below(k, 10); k = Triple(k)) {
        @bump[k = Up(k);]
      }
    `);
    // The end is a step too, after the last test, which leaves k behind.
    expect(trace.map(({ state }) => state.i)).toEqual([0, 0, 1, 2, 3, 3, 3]);
    expect(trace.slice(4).map(({ state }) => state.k)).toEqual([2, 7, undefined]);
  });

  it('run a do...while body once before its test', () => {
    const trace = run(`
      @start[let n = Int(0);]
      do {
        @up[n = Up(n);]
      } while (Below(n, 0));
    `);
    // The start, then the body's step; the test that fails after it changes nothing, so no end.
    expect(trace.map(({ state }) => state.n)).toEqual([0, 1]);
  });
});
