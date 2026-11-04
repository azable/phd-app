import { describe, expect, it } from 'vitest';

import { declaredNames, interpretDomain, traceAlgorithm, type Pacing } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
  const Flag = type('boolean');
`);
const run = (body: string, pacing?: Pacing) =>
  traceAlgorithm(body, undefined, domain, pacing).steps;
// As a view rendering the operator at a label around the whole algorithm.
const showing = (operator: string): Pacing => ({
  shown: new Map([[operator, [{ start: 0, end: Infinity }]]])
});

describe('functions', () => {
  it('are called with their arguments, giving back a position into the caller’s collection', () => {
    const [step] = run(`
      function search(a, target) {
        for (let i = Index(0); (i < a.length); i++) if ((a[i] === target)) return i;
        return Index(-1);
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(5));
    `);
    expect(step.state.found).toBe(2);
    expect(step.targets).toEqual({ found: 'values' });
  });

  it('record their own variables and the top level’s at a step, under the top level’s names', () => {
    // Each comparison shown is a step, and the end another.
    const trace = run(
      `
      function search(a, target) {
        for (let i = Index(0); (i < a.length); i++) {
          @check[if ((a[i] === target)) return i;]
        }
        @miss[return Index(-1);]
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(8));
    `,
      showing('Equal')
    );
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
      first(Values([2]));
    `);
    expect(inside.state).toMatchObject({ values: [2], v: 2 });
  });

  it('recur, each call seeing only its own variables', () => {
    const trace = run(
      `
      function count(a, lo) {
        @test[if ((lo === a.length)) return Int(0);]
        @add[return (a[lo] + (count(a, (lo + 1))));]
      }
      const values = Values([3, 8, 5]);
      const total = count(values, Index(0));
    `,
      { ...showing('Same'), pauses: new Map([['test', 'on']]) }
    );
    // Pausing at each call's test, the innermost's too, where it returns; then the end.
    expect(trace.map(({ state }) => state.lo)).toEqual([0, 1, 2, 3, undefined]);
    expect(trace.at(-1)?.state.total).toBe(16);
  });

  it('read and write the collections given, not the top level’s variables', () => {
    const [step] = run(`
      function bump(a) { for (let i = Index(0); (i < a.length); i++) a[i]++; }
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
      @start[const values = Values([1, 2, 3, 4, 5]);
      let last = Index(0);]
      @down[for (let i = Index(5); (Index(-1) < i); i = (i - 2)) {
        last = i;
      }]
      for (let j = Index(0); (j < values.length); j++) {
        @skip[if ((values[j] % 2 === 0)) continue;]
        @take[const odd = values[j];]
      }
    `;
    // Pausing at the start, the passes down, and the takes: a labelled loop steps once per pass, and
    // the end, which only drops the loop's variables, is no step.
    const trace = run(loops, {
      pauses: new Map(['start', 'down', 'take'].map((label) => [label, 'on']))
    });
    expect(trace.slice(1, 4).map(({ state }) => state.last)).toEqual([5, 3, 1]);
    expect(trace.slice(4).map(({ state }) => state.j)).toEqual([0, 2, 4]);
  });

  it('take any header: a counter declared outside, changed in the body, or a bound that grows', () => {
    const trace = run(`
      @start[let values = Values([1]);
      let i = Index(0);]
      for (i = Index(0); (i < values.length); i++) {
        @grow[if ((values.length < 3)) values.push(1);]
      }
      for (let k = Int(1); (k < 10); k = (k * 3)) {
        @bump[k++;]
      }
    `);
    // @grow pauses at each run, the one finding values long enough too. The last test only drops
    // k, so the end is no step: the last is the bump to 7.
    expect(trace.map(({ state }) => state.i)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(trace.slice(4).map(({ state }) => state.k)).toEqual([2, 7]);
  });

  it('run a do...while body once before its test', () => {
    const trace = run(`
      @start[let n = Int(0);]
      do {
        @up[n++;]
      } while ((n < 0));
    `);
    // The start, then the body's step; the test that fails after it changes nothing, so no end.
    expect(trace.map(({ state }) => state.n)).toEqual([0, 1]);
  });
});
