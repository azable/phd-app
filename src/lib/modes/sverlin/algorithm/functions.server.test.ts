import { describe, expect, it } from 'vitest';

import { declaredNames, interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
`);
const run = (body: string) => interpretAlgorithm(body, undefined, domain);

describe('functions', () => {
  it('are called with their arguments, giving back a position into the caller’s collection', () => {
    const [step] = run(`
      function search(a, target) {
        for (let i = Index(0); i < a.length; i++) if (a[i] === target) return i;
        return Index(-1);
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(5));
    `);
    expect(step.state.found).toBe(2);
    expect(step.targets).toEqual({ found: 'values' });
  });

  it('record their own variables and the top level’s at a step, under the top level’s names', () => {
    // Each Matches call is a step, and the end another.
    const trace = run(`
      function search(a, target) {
        for (let i = Index(0); i < a.length; i++) {
          if (Matches({ at: i, target })) return i;
        }
        return Index(-1);
      }
      const values = Values([3, 8, 5]);
      const found = search(values, Int(8));
    `);
    expect(trace.map(({ state }) => Object.keys(state))).toEqual([
      ['values', 'a', 'target', 'i', 'event', 'history'],
      ['values', 'a', 'target', 'i', 'event', 'history'],
      ['values', 'found', 'event', 'history']
    ]);
    expect(trace[1].targets).toMatchObject({ i: 'values', 'event.Matches[0].at': 'values' });
  });

  it('hide top-level variables of the same name with their parameters', () => {
    const [inside] = run(`
      function first(values) {
        const v = values[0]; // @step
      }
      const values = Values([4, 2]);
      first(values.slice(1));
    `);
    expect(inside.state).toMatchObject({ values: [2], v: 2 });
  });

  it('recur, each call seeing only its own variables', () => {
    const trace = run(`
      function count(a, lo) {
        if (lo === a.length) return Int(0); // @step
        return a[lo] + count(a, lo + 1);
      }
      const values = Values([3, 8, 5]);
      const total = count(values, Index(0));
    `);
    // Each call's test is a step, the innermost's too, where it returns; then the end.
    expect(trace.map(({ state }) => state.lo)).toEqual([0, 1, 2, 3, undefined]);
    expect(trace.at(-1)?.state.total).toBe(16);
  });

  it('read and write the collections given, not the top level’s variables', () => {
    const [step] = run(`
      function bump(a) { for (let i = Index(0); i < a.length; i++) a[i] += 1; }
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
    const trace = run(`
      const values = Values([1, 2, 3, 4, 5]);
      for (let i = Index(4); i >= 0; i -= 2) {} // @step
      for (let j = Index(0); j < values.length; j++) {
        if (values[j] % 2 === 0) continue;
        const odd = values[j]; // @step
      }
    `);
    // A labelled loop steps once per pass; the end, with neither in scope, is the last.
    expect(trace.map(({ state }) => state.i ?? state.j)).toEqual([4, 2, 0, 0, 2, 4, undefined]);
  });

  it('take any header: a counter declared outside, changed in the body, or a bound that grows', () => {
    const trace = run(`
      const values = Values([1]);
      let i = Index(0);
      for (i = Index(0); i < values.length; i++) {
        if (values.length < 3) values.push(1); // @step
      }
      for (let k = Int(1); k < 10; k = k * 3) {
        k++; // @step
      }
    `);
    // The end is a step too, after the last test.
    expect(trace.map(({ state }) => state.i)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(trace.slice(3).map(({ state }) => state.k)).toEqual([2, 7, undefined]);
  });

  it('run a do...while body once before its test', () => {
    const trace = run(`
      let n = Int(0);
      do {
        n++; // @step
      } while (n < 0);
    `);
    // The body's step, then the end after the test that fails.
    expect(trace.map(({ state }) => state.n)).toEqual([1, 1]);
  });
});
