import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: -100, max: 1000 });
  const Real = type('number', { min: -100, max: 1000 });
  const Bool = type('boolean');
  const Text = type(['yes', 'no', 'ab', 'abc']);
  const Height = type(Int, { unit: 'cm', min: 0, max: 300 });
  const Weight = type(Int, { unit: 'kg' });
  const Suit = type(['♠', '♥', '♦', '♣']);
  const Grade = type([1, 2, 3]);
  const Ints = collection(Int);
  const Person = record({ height: Height });
`);

/** Run an algorithm with the test domain and return its last step. */
function last(body: string) {
  const trace = interpretAlgorithm(body, { state: {}, types: {} }, domain);
  return trace[trace.length - 1];
}

describe('atomic type definitions', () => {
  it('defines primitive kinds, refinements, and enumerations', () => {
    expect(domain.atoms.Int).toEqual({ name: 'Int', base: 'integer', min: -100, max: 1000 });
    expect(domain.atoms.Height).toEqual({
      name: 'Height',
      base: 'integer',
      parent: 'Int',
      unit: 'cm',
      min: 0,
      max: 300
    });
    expect(domain.atoms.Suit).toEqual({ name: 'Suit', base: 'text', values: ['♠', '♥', '♦', '♣'] });
    expect(domain.atoms.Grade.base).toBe('integer');
    expect(interpretDomain('')).toEqual({ atoms: {}, structures: {} });
  });

  it.each([
    ['undefined base types', 'const A = type(Int);', /Unknown type Int; define it first/],
    ['unknown kinds', 'const A = type("float");', /Unknown kind "float"/],
    ['anything but type()', 'const A = 3;', /Define A with type/],
    ['statements', 'let A = type(Int);', /only defines types/],
    ['mixed enumerations', 'const A = type(["x", 1]);', /all text or all numbers/],
    ['repeated enumeration values', 'const A = type(["x", "x"]);', /each listed once/],
    ['unknown options', 'const A = type("integer", { colour: "red" });', /Unknown type\(\) option/],
    ['ranges on text', 'const A = type("text", { min: 1 });', /only applies to integer and number/],
    [
      'inverted ranges',
      'const A = type("integer", { min: 5, max: 1 });',
      /min must not exceed max/
    ],
    [
      'integers without a range',
      'const A = type("integer");',
      "Give A a min and a max, as in const A = type('integer', { min: 0, max: 9 });. Every type must have a known, finite set of values, so the view can be drawn for each of them."
    ],
    [
      'numbers with only a min',
      'const A = type("number", { min: -1 });',
      "Give A a max, as in const A = type('number', { min: -1, max: 8 });."
    ],
    [
      'numbers with only a max',
      'const A = type("number", { max: 100 });',
      "Give A a min, as in const A = type('number', { min: 0, max: 100 });."
    ],
    [
      'open text',
      'const A = type("text");',
      "List the values of A, as in const A = type(['start', 'done']);."
    ]
  ])('rejects %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});

describe('typed values', () => {
  it('records the type of every typed value by path, carried from the input', () => {
    const input = interpretInput(
      'const values = Ints([3, 8]); const person = Person({ height: 170 });',
      domain
    );
    expect(input.types).toEqual({
      values: 'Ints',
      'values[0]': 'Int',
      'values[1]': 'Int',
      person: 'Person',
      'person.height': 'Height'
    });
    const trace = interpretAlgorithm(
      'yield; const t = values[0]; values[0] = values[1]; values[1] = t; yield;',
      input,
      domain
    );
    expect(trace[1].state.values).toEqual([8, 3]);
    expect(trace[1].types).toMatchObject({ 'values[0]': 'Int', 'values[1]': 'Int', t: 'Int' });
  });

  it('checks values when they are created', () => {
    expect(() => last('const a = Int(3.5); yield;')).toThrow(/whole numbers/);
    expect(() => last('const a = Height(-1); yield;')).toThrow(/at least 0/);
    expect(() => last('const a = Suit("x"); yield;')).toThrow(/not a Suit/);
    expect(() => last('const a = Bool(1); yield;')).toThrow(/true or false/);
    expect(() => last('const a = Height(Suit("♠")); yield;')).toThrow(/cannot become/);
  });

  it('carries types through arithmetic and adopts the more specific type', () => {
    const step = last(`
      const a = Int(7) + Int(2);
      const b = Real(Int(7) / Int(2));
      const c = Real(Int(7) + 0.5);
      const d = Height(150) + Int(5);
      const e = Height(150) * 2;
      let f = Int(1);
      f++;
      const g = -Weight(5);
      yield;
    `);
    expect(step.state).toMatchObject({ a: 9, b: 3.5, c: 7.5, d: 155, e: 300, f: 2, g: -5 });
    // b and c are no longer whole, so they leave the integer type, and are kept as Real.
    expect(step.types).toEqual({
      a: 'Int',
      b: 'Real',
      c: 'Real',
      d: 'Height',
      e: 'Height',
      f: 'Int',
      g: 'Weight'
    });
  });

  it.each([
    ['combining unrelated types', 'const a = Height(1) + Weight(1);', /cannot be combined/],
    ['comparing unrelated types', 'const a = Height(1) < Weight(1);', /cannot be combined/],
    ['equating unrelated types', 'const a = Height(1) === Weight(1);', /cannot be combined/],
    ['leaving an enumeration', 'const a = Grade(3) + 1;', /4 is not a Grade/],
    ['arithmetic on Bool', 'const a = Bool(true) + 1;', /cannot be used in arithmetic/],
    ['leaving a range', 'const a = Height(10) - 20;', /at least 0/]
  ])('rejects %s', (_name, statement, message) => {
    expect(() => last(`${statement} yield;`)).toThrow(message);
  });

  it('compares, tests, and searches typed values by value', () => {
    const step = last(`
      const values = Ints([3, 8, 5]);
      const target = Int(8);
      const equal = Bool(values[1] === target);
      const plainEqual = Bool(values[1] === 8);
      const position = Int(values.indexOf(target));
      const present = Bool(values.includes(Int(5)));
      const falsy = Text(Bool(false) ? 'yes' : 'no');
      let count = Int(0);
      if (Bool(true)) count += 1;
      const name = Text('ab') + 'c';
      const length = Int(Text('abc').length);
      yield;
    `);
    expect(step.state).toMatchObject({
      equal: true,
      plainEqual: true,
      position: 1,
      present: true,
      falsy: 'no',
      count: 1,
      name: 'abc',
      length: 3
    });
    expect(step.types.name).toBe('Text');
  });

  it('keeps constructors and type definitions in their blocks', () => {
    expect(() => last('const A = type(Int); yield;')).toThrow(/belongs in the domain block/);
  });
});
