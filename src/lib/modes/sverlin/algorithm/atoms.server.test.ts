import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const types = `
  const Int = type('integer', { min: -100, max: 1000 });
  const Real = type('number', { min: -100, max: 1000, places: 2 });
  const Bool = type('boolean');
  const Text = type(['yes', 'no', 'ab', 'abc']);
  const Height = type('integer', { unit: 'cm', min: 0, max: 300 });
  const Weight = type('integer', { unit: 'kg', min: -100, max: 100 });
  const Suit = type(['♠', '♥', '♦', '♣']);
  const Grade = type([1, 2, 3]);
  const Ints = collection(Int);
  const Person = record({ height: Height });
`;
const domain = interpretDomain(types);

/** Run an algorithm with the test domain, and these operators, and return its last step. */
function last(body: string, operators = '') {
  const trace = interpretAlgorithm(
    body,
    { state: {}, types: {} },
    operators ? interpretDomain(`${types}${operators}`) : domain
  );
  return trace[trace.length - 1];
}

describe('atomic type definitions', () => {
  it('defines primitive kinds, each on its own, and enumerations', () => {
    expect(domain.atoms.Int).toEqual({ name: 'Int', base: 'integer', min: -100, max: 1000 });
    expect(domain.atoms.Height).toEqual({
      name: 'Height',
      base: 'integer',
      unit: 'cm',
      min: 0,
      max: 300
    });
    expect(domain.atoms.Real.places).toBe(2);
    expect(domain.atoms.Suit).toEqual({ name: 'Suit', base: 'text', values: ['♠', '♥', '♦', '♣'] });
    expect(domain.atoms.Grade.base).toBe('integer');
    expect(interpretDomain('')).toEqual({ atoms: {}, structures: {}, operators: {} });
  });

  it.each([
    ['types made from another', 'const A = type(Int);', /declared on its own, not from another/],
    [
      'numbers without places',
      'const A = type("number", { min: 0, max: 1 });',
      /Give A its places/
    ],
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
      "Give A a max, as in const A = type('number', { min: -1, max: 8, places: 2 });."
    ],
    [
      'numbers with only a max',
      'const A = type("number", { max: 100 });',
      "Give A a min, as in const A = type('number', { min: 0, max: 100, places: 2 });."
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
      'const t = values[0]; values[0] = values[1]; values[1] = t;',
      input,
      domain
    );
    expect(trace[0].state.values).toEqual([8, 3]);
    expect(trace[0].types).toMatchObject({ 'values[0]': 'Int', 'values[1]': 'Int', t: 'Int' });
  });

  it('checks values when they are created', () => {
    expect(() => last('const a = Int(3.5);')).toThrow(/whole numbers/);
    expect(() => last('const a = Height(-1);')).toThrow(/at least 0/);
    expect(() => last('const a = Suit("x");')).toThrow(/not a Suit/);
    expect(() => last('const a = Bool(1);')).toThrow(/true or false/);
    expect(() => last('const a = Height(Suit("♠"));')).toThrow(/cannot become/);
  });

  it('computes raw, carrying types through arithmetic', () => {
    const step = last(
      `
      const a = Int(7) + Int(2);
      const b = Real(Int(7) / 2);
      const d = Height(150) + 5;
      const g = -Weight(5);
    `,
      `
    `
    );
    expect(step.state).toMatchObject({ a: 9, b: 3.5, d: 155, g: -5 });
    expect(step.types).toEqual({ a: 'Int', b: 'Real', d: 'Height', g: 'Weight' });
  });

  it.each([
    ['combining unrelated types', 'const a = Height(1) + Weight(1);', /cannot be combined/],
    ['comparing unrelated types', 'const a = Height(1) < Weight(1);', /cannot be combined/],
    ['equating unrelated types', 'const a = Height(1) === Weight(1);', /cannot be combined/],
    ['leaving an enumeration', 'const a = Grade(3) + 1;', /4 is not a Grade/],
    ['arithmetic on Bool', 'const a = Bool(true) + 1;', /cannot be used in arithmetic/],
    ['leaving a range', 'const a = Height(10) - 20;', /at least 0/],
    ['Math without a type', 'const a = Math.floor(Int(7) / 2);', /gives a plain number/],
    ['division without a type', 'const a = Int(7) / 2;', /gives a plain number/],
    [
      'a search',
      'const a = Ints([3, 8]); const i = a.indexOf(Int(8));',
      /does a whole loop in one step/
    ],
    ['a copy', 'const a = Ints([3, 8]); const b = Ints([...a]);', /copies every element/],
    ['text joined', "const a = Text('ab') + 'c';", /joins no text/],
    [
      'collections compared',
      'const a = Ints([1]); const b = Ints([1]); const c = a === b;',
      /compares which collection/
    ]
  ])('rejects %s', (_name, body, message) => {
    expect(() => last(body)).toThrow(message);
  });

  it('rounds a number to its places as it enters the type', () => {
    const step = last('const a = Real(Int(10) / 3); const b = Real(0.1 + 0.2);');
    expect(step.state).toMatchObject({ a: 3.33, b: 0.3 });
  });

  it('compares and tests typed values by value', () => {
    const step = last(
      `
      const values = Ints([3, 8, 5]);
      const target = Int(8);
      const equal = values[1] === target;
      const plainEqual = values[1] === 8;
      const falsy = Text(Bool(false) ? 'yes' : 'no');
      let count = Int(0);
      if (Bool(true)) count = count + Int(1);
    `,
      `
    `
    );
    expect(step.state).toMatchObject({
      equal: true,
      plainEqual: true,
      falsy: 'no',
      count: 1
    });
  });

  it('keeps constructors and type definitions in their blocks', () => {
    expect(() => last('const A = type(Int);')).toThrow(/belongs in the domain block/);
  });
});
