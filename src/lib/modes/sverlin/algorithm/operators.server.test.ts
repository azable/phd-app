import { describe, expect, it } from 'vitest';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const types = `
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
`;
const domain = interpretDomain(`${types}
  const Length = unop(Values, (v) => Index(v.length));
  const Before = binop(Index, Index, (a, b) => Flag(a < b));
  const Next = unop(Index, (p) => Index(p + 1));
  const Equal = binop(Int, Int, (a, b) => Flag(a === b));
  const Add = binop(Int, Int, (a, b) => Int(a + b));
  const Floor = unop(Int, (x) => Int(Math.floor(x / 2)));
`);
const input = interpretInput('const values = Values([3, 8, 5]); const target = Int(5);', domain);
const run = (body: string) => traceAlgorithm(body, input, domain).steps;

describe('operators', () => {
  it('are declared with their operands’ types and a function of them, naming their parts', () => {
    expect(domain.operators?.Before).toMatchObject({
      name: 'Before',
      operands: ['Index', 'Index'],
      parameters: ['a', 'b'],
      result: 'Flag'
    });
    expect(domain.operators?.Length).toMatchObject({ operands: ['Values'], result: 'Index' });
  });

  it('are applied as calls, giving their function’s typed value, logged with their operands', () => {
    const [step] = run(`
      let i = Index(0);
      while (Before(i, Length(values))) {
        if (Equal(values[i], target)) break;
        i = Next(i);
      }
      const total = Add(values[0], Floor(target));
    `);
    expect(step.state).toMatchObject({ i: 2, total: 5 });
    expect(step.types).toMatchObject({ i: 'Index', total: 'Int' });
    expect(step.targets).toMatchObject({ i: 'values' });
    const applied = step.events?.filter(({ kind }) => kind === 'apply') ?? [];
    expect(applied.slice(0, 3).map(({ name, operands, value }) => [name, operands, value])).toEqual(
      [
        ['Length', [null], 3],
        ['Before', [0, 3], true],
        ['Equal', [3, 5], false]
      ]
    );
    expect(step.counts?.calls).toMatchObject({ Equal: 3, Add: 1 });
  });

  it('report a problem in their function at the application', () => {
    expect(() => run('const n = Add(Int(7), Int(5));')).toThrow(
      'Add(7, 5): Int values must be at most 9, not 12.'
    );
    expect(() => run('const n = Add(Int(1));')).toThrow(
      'Add(...) takes two operands, an Int and an Int.'
    );
  });

  it.each([
    [
      'a function giving no typed value',
      'const Bad = binop(Int, Int, (a, b) => a > b);',
      'Bad gives a typed value: wrap what it computes in a type defined above'
    ],
    [
      'a function with braces',
      'const Bad = unop(Int, (a) => { return Int(a); });',
      'An operator’s function is one expression, without braces'
    ],
    [
      'a function reading the state',
      'const Bad = unop(Int, (a) => Int(a + values[0]));',
      'Bad reads only its operands (a) and Math, not values.'
    ],
    [
      'a function using another operator',
      'const Up = unop(Int, (a) => Int(a + 1)); const Bad = unop(Int, (a) => Up(a));',
      'Bad gives a typed value'
    ],
    [
      'a function using another operator inside',
      'const Up = unop(Int, (a) => Int(a + 1)); const Bad = unop(Int, (a) => Int(Up(a)));',
      'Bad cannot use the operator Up: an operator computes from its operands alone.'
    ],
    [
      'the wrong number of operands',
      'const Bad = binop(Int, (a, b) => Flag(a < b));',
      'binop() takes its two operands’ types, then a function of them'
    ],
    ['operands of unknown types', 'const Bad = unop(Nope, (a) => Flag(a));', 'Unknown type Nope'],
    [
      'an operator as an operand type',
      'const Up = unop(Int, (a) => Int(a + 1)); const Bad = unop(Up, (a) => Int(a));',
      'Up is an operator, not a type.'
    ]
  ])('reject %s', (_name, declaration, message) => {
    expect(() => interpretDomain(`${types}${declaration}`)).toThrow(message);
  });
});

describe('no raw JavaScript but control flow', () => {
  it.each([
    [
      'a comparison',
      'const f = Flag(values[0] > values[1]);',
      'values[0] > values[1]: > on Int values; declare it, as const Greater = binop(Int, Int, (a, b) => Flag(a > b));, and write Greater(values[0], values[1]).'
    ],
    [
      'arithmetic',
      'const n = Int(target + 1);',
      'target + 1: + on Int values; declare it, as const Add = binop(Int, Int, (a, b) => Int(a + b));, and write Add(target, 1).'
    ],
    [
      'a compound assignment',
      'let n = Int(0); n += target;',
      'n += target: += on Int values; declare it, as const Add = binop(Int, Int, (a, b) => Int(a + b));, and write n = Add(n, target).'
    ],
    [
      'an increment',
      'let i = Index(0); i++;',
      'i++: ++ on an Index; declare it, as const Next = unop(Index, (p) => Index(p + 1));, and write i = Next(i).'
    ],
    [
      'a negation',
      'let f = Flag(true); f = !f;',
      '!f: ! on a Flag; declare it, as const Not = unop(Flag, (x) => Flag(!x));, and write Not(f).'
    ],
    [
      '.length',
      'const n = Index(values.length);',
      'values.length: .length on a Values; declare it, as const Length = unop(Values, (v) => Index(v.length));, and write Length(values).'
    ],
    [
      'Math',
      'const n = Int(Math.max(1, 2));',
      'Math is used only inside an operator’s function; declare one'
    ],
    [
      'a template string',
      'const s = `${target}`;',
      '`${target}`: a template string is computed inside an operator’s function'
    ],
    [
      'code that never runs',
      'if (false) { const n = Int(target - 1); }',
      'target - 1: -; declare it, as const Subtract = binop(Int, Int, (a, b) => Int(a - b));, and write Subtract(target, 1).'
    ]
  ])('reject %s, naming the operator to declare', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it('keep negative literals, control flow, and typed literals raw', () => {
    const [step] = run(`
      let i = Index(-1);
      const found = Flag(true);
      const pick = found && found ? Int(1) : Int(2);
    `);
    expect(step.state).toMatchObject({ i: -1, pick: 1 });
  });

  it('hold in the input too, where operators do not apply', () => {
    expect(() => interpretInput('const n = Int(1 + 2);', domain)).toThrow(
      '1 + 2: + on Int values; declare it'
    );
    expect(() => interpretInput('const n = Add(Int(1), Int(2));', domain)).toThrow(
      'Add(...) is an operator, which the algorithm applies.'
    );
  });
});
