import { describe, expect, it } from 'vitest';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const types = `
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
`;
const domain = interpretDomain(`${types}
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
  const Add = binop((a: Int, b: Int) => Int(a + b));
  const Floor = unop((x: Int) => Int(Math.floor(x / 2)));
  const Append = binop((c: Values, x: Int) => Values([...c, x]));
  const Rest = unop((c: Values) => Values(c.slice(1)));
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
      'const Bad = binop((a: Int, b: Int) => a > b);',
      'Bad gives a typed value: wrap what it computes in a type defined above'
    ],
    [
      'a function with braces',
      'const Bad = unop((a: Int) => { return Int(a); });',
      'An operator’s function is one expression, without braces'
    ],
    [
      'a function reading the state',
      'const Bad = unop((a: Int) => Int(a + values[0]));',
      'Bad reads only its operands (a) and Math, not values.'
    ],
    [
      'a function using another operator',
      'const Up = unop((a: Int) => Int(a + 1)); const Bad = unop((a: Int) => Up(a));',
      'Bad gives a typed value'
    ],
    [
      'a function using another operator inside',
      'const Up = unop((a: Int) => Int(a + 1)); const Bad = unop((a: Int) => Int(Up(a)));',
      'Bad cannot use the operator Up: an operator computes from its operands alone.'
    ],
    [
      'the wrong number of operands',
      'const Bad = binop((a: Int) => Flag(a));',
      "Bad's function takes 2 typed names, one per operand"
    ],
    [
      'an operand without its type',
      'const Bad = binop((a: Int, b) => Flag(a < b));',
      'Give b its type, as in binop((a: Int, b: Int) => Flag(a > b)).'
    ],
    [
      'the earlier form, the operand types given first',
      'const Bad = binop(Int, Int, (a, b) => Flag(a < b));',
      "An operator's operand types are written on its parameters: const Bad = binop((a: Int, b: Int) => Flag(a < b));"
    ],
    [
      'a type written anywhere but on an operator’s parameter',
      'const Bad = unop((a: Int) => Int(a)); const c: Int = 1;',
      "Type annotations are written only on an operator's parameters, as (q: Queue, x: Letter) => …"
    ],
    ['operands of unknown types', 'const Bad = unop((a: Nope) => Flag(a));', 'Unknown type Nope'],
    [
      'an operator as an operand type',
      'const Up = unop((a: Int) => Int(a + 1)); const Bad = unop((a: Up) => Int(a));',
      'Up is an operator, not a type.'
    ]
  ])('reject %s', (_name, declaration, message) => {
    expect(() => interpretDomain(`${types}${declaration}`)).toThrow(message);
  });
});

describe('primitive operators', () => {
  it('refuse a body that is an algorithm: a callback, or a method outside the subset', () => {
    expect(() =>
      interpretDomain(
        `${types}const Merge = binop((a: Values, b: Values) => Values([...a, ...b].sort((x, y) => x - y)));`
      )
    ).toThrow(
      'An operator is one primitive step; sort is an algorithm, so write it out in the algorithm block.'
    );
    expect(() =>
      interpretDomain(`${types}const Some = unop((a: Values) => Flag(a.includes((x) => x)));`)
    ).toThrow(
      'An operator is one primitive step, and a function inside it, as for sort, map, or filter, makes it an algorithm: write that out in the algorithm block.'
    );
    // The subset's methods are primitive steps.
    expect(() =>
      interpretDomain(`${types}const Rest = unop((a: Values) => Values(a.slice(1)));`)
    ).not.toThrow();
  });
});

describe('discarded results', () => {
  it.each([
    [
      'a statement',
      'let queue = Values([]); Append(queue, target);',
      'Append(queue, target) computes a Values and discards it; operators change nothing. Write queue = Append(queue, target).'
    ],
    [
      'a for update',
      'for (let i = Index(0); Before(i, Length(values)); Next(i)) {}',
      'Next(i) computes an Index and discards it; operators change nothing. Write i = Next(i).'
    ],
    [
      'a short-circuit side',
      'let n = Int(0); Equal(n, target) || Add(n, target);',
      'Add(n, target) computes an Int and discards it; operators change nothing. Write n = Add(n, target).'
    ],
    [
      'a result of another type',
      'Equal(values[0], target);',
      'Equal(values[0], target) computes a Flag and discards it; operators change nothing. Write const result = Equal(values[0], target).'
    ],
    [
      'code that never runs',
      'let n = Int(0); if (false) Add(n, target);',
      'Add(n, target) computes an Int and discards it'
    ]
  ])('reject %s, naming the write', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it('allow a used result, and the algorithm’s own functions as statements', () => {
    expect(() =>
      run('let n = Int(0); if (Equal(Add(n, 1), target)) n = Add(n, 1); const f = Equal(n, 1);')
    ).not.toThrow();
    expect(() =>
      run('function grow(a) { return Length(a); } grow(values); const k = grow(values);')
    ).not.toThrow();
  });
});

describe('no raw JavaScript but control flow', () => {
  it.each([
    [
      'a comparison',
      'const f = Flag(values[0] > values[1]);',
      'values[0] > values[1]: > on Int values; declare it, as const Greater = binop((a: Int, b: Int) => Flag(a > b));, and write Greater(values[0], values[1]).'
    ],
    [
      'arithmetic',
      'const n = Int(target + 1);',
      'target + 1: + on Int values; declare it, as const Add = binop((a: Int, b: Int) => Int(a + b));, and write Add(target, 1).'
    ],
    [
      'a compound assignment',
      'let n = Int(0); n += target;',
      'n += target: += on Int values; declare it, as const Add = binop((a: Int, b: Int) => Int(a + b));, and write n = Add(n, target).'
    ],
    [
      'an increment',
      'let i = Index(0); i++;',
      'i++: ++ on an Index; declare it, as const Next = unop((p: Index) => Index(p + 1));, and write i = Next(i).'
    ],
    [
      'a negation',
      'let f = Flag(true); f = !f;',
      '!f: ! on a Flag; declare it, as const Not = unop((x: Flag) => Flag(!x));, and write Not(f).'
    ],
    [
      '.length',
      'const n = Index(values.length);',
      'values.length: .length on a Values; declare it, as const Length = unop((v: Values) => Index(v.length));, and write Length(values).'
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
      'target - 1: -; declare it, as const Subtract = binop((a: Int, b: Int) => Int(a - b));, and write Subtract(target, 1).'
    ]
  ])('reject %s, naming the operator to declare', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it.each([
    [
      'a push',
      'values.push(target);',
      'values.push(target): computes a new Values from values; declare an operator, as const Append = binop((c: Values, x: Int) => Values([...c, x]));, and write values = Append(values, target).'
    ],
    [
      'a shift',
      'const front = Int(values.shift());',
      'values.shift(): computes a new Values from values; declare an operator, as const Rest = unop((c: Values) => Values(c.slice(1)));, read what it takes first (values[0]), and write values = Rest(values).'
    ],
    [
      'a reverse',
      'values.reverse();',
      'const Reversed = unop((c: Values) => Values(c.slice().reverse()));, and write values = Reversed(values).'
    ],
    [
      'a search',
      'const at = Index(values.indexOf(target));',
      'values.indexOf(target): computed from values; declare an operator, as const Find = binop((c: Values, x: Int) => Index(c.indexOf(x)));, and write Find(values, target).'
    ],
    [
      'a membership test',
      'const has = Flag(values.includes(target));',
      'const Has = binop((c: Values, x: Int) => Flag(c.includes(x)));'
    ],
    [
      'a slice',
      'const part = values.slice(1);',
      'values.slice(1): computed from values; declare an operator'
    ],
    [
      'a push that never runs',
      'if (false) { values.push(target); }',
      'values.push(target): computes a new Values from values; declare an operator'
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

describe('writes', () => {
  it('are plain =, of an operator’s result or any value, logged as writes', () => {
    const [step] = run(`
      let i = Index(0);
      i = Next(i);
      values[i] = target;
      let found = Flag(false);
      found = Equal(values[i], target);
    `);
    expect(step.state).toMatchObject({ i: 1, values: [3, 5, 5], found: true });
    const written = step.events?.filter(({ kind }) => kind === 'write') ?? [];
    expect(written.map(({ place, value }) => [place, value])).toEqual([
      ['i', 0],
      ['i', 1],
      ['values[1]', 5],
      ['found', false],
      ['found', true]
    ]);
  });

  it('write a collection an operator computed in place, its elements keeping their identities', () => {
    const steps = traceAlgorithm(
      `@join[values = Append(values, target);]
       @leave[values = Rest(values);]`,
      input,
      domain
    ).steps;
    const [joined, left] = steps;
    expect(joined.state.values).toEqual([3, 8, 5, 5]);
    expect(left.state.values).toEqual([8, 5, 5]);
    const ids = (step: (typeof steps)[number]) => step.identities!.ids;
    // The collection is the same one; its elements move up as the front leaves.
    expect(ids(left).values).toBe(ids(joined).values);
    expect(ids(left)['values[0]']).toBe(ids(joined)['values[1]']);
    expect(ids(left)['values[2]']).toBe(ids(joined)['values[3]']);
  });

  it('give a place a collection the state already holds itself, as another row of a grid', () => {
    const grid = interpretDomain(`${types}const Table = collection(Values);`);
    const [step] = traceAlgorithm(
      'const table = Table([[1, 2], [3, 4]]); let row = table[1]; row = table[0];',
      undefined,
      grid
    ).steps;
    // The rows are unchanged; row is the first one now.
    expect(step.state).toMatchObject({
      table: [
        [1, 2],
        [3, 4]
      ],
      row: [1, 2]
    });
    expect(step.identities!.ids.row).toBe(step.identities!.ids['table[0]']);
  });

  it('reject a value of another type and a constant', () => {
    expect(() => run('let i = Index(0); i = values[0];')).toThrow('i must be a Index, not a Int');
    expect(() => run('const n = Int(1); n = Int(2);')).toThrow(
      '"n" is a constant; declare it with let to change it.'
    );
  });

  it('keep operators from changing anything, what they are given included', () => {
    expect(() => interpretDomain(`${types}const Bad = unop((a: Int) => Int(a = 1));`)).toThrow(
      'Bad computes a value and changes nothing.'
    );
    const changing = interpretDomain(
      `${types}const Grow = unop((c: Values) => Values(c.push(1) ? c : c));`
    );
    expect(() => traceAlgorithm('const v = Grow(values);', input, changing)).toThrow(
      'An operator computes a new value and changes nothing: write the new collection, as [...c, x] or c.slice(1), not c.push().'
    );
  });
});
