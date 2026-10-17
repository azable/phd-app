import { describe, expect, it } from 'vitest';

import {
  algorithmLimits,
  interpretAlgorithm as interpretTyped,
  interpretDesign,
  interpretDomain,
  interpretInput as interpretTypedInput,
  type TypedState
} from './interpret.server';

// Input and algorithm values all have domain types; these tests share a small domain.
const atoms = interpretDomain(
  "const Int = type('integer'); const Real = type('number'); const Flag = type('boolean'); const Text = type('text'); const Ints = collection(Int); const Reals = collection(Real); const Grid = collection(Ints); const Point = record({ x: Int, y: Int });"
);
const interpretAlgorithm = (body: string, input?: TypedState) => interpretTyped(body, input, atoms);
const interpretInput = (body: string) => interpretTypedInput(body, atoms);
const plain = <T extends { types: unknown }>(step: T) => ({ ...step, types: undefined });

describe('algorithm interpretation', () => {
  it('records every top-level binding at each yield', () => {
    const trace = interpretAlgorithm(`
      const values = Ints([3, 8, 5]);
      let i = Int(-1);
      let found = Flag(false);
      yield 'Start';
      for (i = Int(0); i < values.length; i++) {
        yield \`Compare \${values[i]}\`;
        if (values[i] === 8) {
          found = Flag(true);
          yield 'Found';
          break;
        }
      }
    `);
    expect(trace.map(({ label }) => label)).toEqual(['Start', 'Compare 3', 'Compare 8', 'Found']);
    expect(trace[0].state).toEqual({ values: [3, 8, 5], i: -1, found: false });
    expect(trace[3].state).toEqual({ values: [3, 8, 5], i: 1, found: true });
  });

  it('snapshots state so later mutations do not change earlier steps', () => {
    const trace = interpretAlgorithm(`
      const a = Ints([2, 1]);
      yield 'Before';
      const t = a[0]; a[0] = a[1]; a[1] = t;
      yield 'After';
    `);
    expect(trace[0].state.a).toEqual([2, 1]);
    expect(trace[1].state.a).toEqual([1, 2]);
    expect(trace[0].state.t).toBeNull();
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
      yield stack.join('-');
      return;
      yield 'Unreachable';
    `);
    expect(trace.map(plain)).toEqual([
      {
        label: '2-3-4',
        state: { stack: [2, 3, 4], point: { x: 2, y: 2 }, total: 29, k: 3, i: 1, a: [5, 0] },
        types: undefined
      }
    ]);
  });

  it.each([
    ['functions', 'function f() {} yield "A";', /Function Declaration is not supported/],
    ['arrow functions', 'const f = () => 1; yield "A";', /Arrow Function Expression/],
    ['global access', 'const w = globalThis; yield "A";', /"globalThis" is not defined/],
    [
      'constructor escapes',
      'const a = Ints([]); const c = a.constructor; yield "A";',
      /not allowed/
    ],
    [
      'prototype keys',
      'const o = Point({ x: 1, y: 2 }); o["__proto__"] = 1; yield "A";',
      /not allowed/
    ],
    ['host methods', 'const s = Text("x"); yield s.repeat(3);', /only available on arrays/],
    ['new', 'const d = new Date(); yield "A";', /New Expression/],
    ['loose equality', 'yield 1 == 1 ? "A" : "B";', /Use ===/],
    ['reserved names', 'let step = Int(0); yield "A";', /reserved/],
    ['undeclared assignment', 'x = Int(1); yield "A";', /must be declared/],
    ['no steps', 'let x = Int(1);', /at least one step/],
    ['non-string labels', 'yield 3;', /non-empty strings/],
    ['nested yield', 'const a = Ints([yield "A"]);', /statement of its own/],
    [
      'object arithmetic',
      'const o = Point({ x: 1, y: 2 }); yield "A" + (o - 1);',
      /Expected a number/
    ],
    ['plain arrays', 'const a = [Int(1)]; yield "A";', /Arrays are made by a collection type/],
    ['plain objects', 'const o = { x: Int(1) }; yield "A";', /Objects are made by a record type/]
  ])('rejects %s', (_name, body, message) => {
    expect(() => interpretAlgorithm(body)).toThrow(message);
  });

  it('stops endless loops and oversized state', () => {
    expect(() => interpretAlgorithm('while (true) {} yield "A";')).toThrow(/operations/);
    expect(() =>
      interpretAlgorithm('let s = Text("ab"); while (true) { s = s + s; } yield "A";')
    ).toThrow(/characters/);
    expect(() =>
      interpretAlgorithm('let a = Ints([1]); while (true) { a = Ints([...a, ...a]); } yield "A";')
    ).toThrow(/entries/);
    expect(() =>
      interpretAlgorithm(
        'let a = Ints([1]); for (let i = Int(0); i < 13; i++) a = Ints([...a, ...a]); for (let j = Int(0); j < 30; j++) yield `S${j}`;'
      )
    ).toThrow(/too large/);
    expect(() =>
      interpretAlgorithm(
        `for (let i = Int(0); i <= ${algorithmLimits.maximumSteps}; i++) yield \`S\${i}\`;`
      )
    ).toThrow(/more than/);
  });

  it('reports offsets into the algorithm body', () => {
    const body = 'let x = Int(1);\nyield "A";\nx = y;';
    expect(() => interpretAlgorithm(body)).toThrow(
      expect.objectContaining({ offset: body.indexOf('y;') })
    );
    expect(() => interpretAlgorithm('let x = ;')).toThrow(
      expect.objectContaining({ name: 'AlgorithmError', offset: 8 })
    );
  });
});

describe('input, design, and step selection', () => {
  it('starts the algorithm from the input and records input variables', () => {
    const input = interpretInput('const values = Ints([2, 1]); const label = Text("pair");');
    const trace = interpretAlgorithm(
      'yield "Start"; values.reverse(); let swapped = Flag(true); yield "Swapped";',
      input
    );
    expect(trace.map(({ state }) => state)).toEqual([
      { values: [2, 1], label: 'pair', swapped: null },
      { values: [1, 2], label: 'pair', swapped: true }
    ]);
    expect(input.state.values).toEqual([2, 1]);
    expect(() => interpretAlgorithm('let values = Ints([]); yield "A";', input)).toThrow(
      /already declared here or in the input/
    );
    expect(() => interpretInput('const x = Int(1); yield "A";')).toThrow(/algorithm block/);
  });

  it('draws design values deterministically from the seed', () => {
    const body =
      'const layout = pick(["row", "grid", "stack"]); const size = int(3, 6); const scale = real(0.5, 1.5); const bold = chance(0.5); const doubled = size * 2;';
    const first = interpretDesign(body, 42);
    expect(interpretDesign(body, 42)).toEqual(first);
    expect(['row', 'grid', 'stack']).toContain(first.layout);
    expect(first.size).toBeGreaterThanOrEqual(3);
    expect(first.size).toBeLessThanOrEqual(6);
    expect(first.doubled).toBe((first.size as number) * 2);
    const layouts = new Set(
      Array.from({ length: 30 }, (_, seed) => interpretDesign(body, seed + 1).layout)
    );
    expect(layouts.size).toBe(3);
  });

  it.each([
    ['draws outside the design block', () => interpretAlgorithm('const a = pick([1]); yield "A";')],
    ['draws not assigned to a top-level const', () => interpretDesign('let a = pick([1]);', 1)],
    ['draws inside expressions', () => interpretDesign('const a = pick([1]) + 1;', 1)],
    ['draws inside blocks', () => interpretDesign('if (true) { const a = int(1, 2); }', 1)],
    ['removed optional yields', () => interpretAlgorithm('yield optional("x");')],
    ['unknown functions', () => interpretDesign('const a = shuffle([1]);', 1)]
  ])('rejects %s', (_name, run) => {
    expect(run).toThrow(/design draw|not available/);
  });

  it('keys each draw by its name, so other draws never change it', () => {
    const before = 'const a = pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); const b = real(0, 1);';
    const after =
      'const extra = int(0, 100); const b = real(0, 1); const late = chance(0.5); const a = pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);';
    for (const seed of [1, 2, 3, 99, 123456]) {
      const first = interpretDesign(before, seed);
      const second = interpretDesign(after, seed);
      expect(second.a).toBe(first.a);
      expect(second.b).toBe(first.b);
    }
  });

  it('keys nested draws by their path, independently of each other and of order', () => {
    const one = interpretDesign(
      'const look = { x: real(0, 1), y: real(0, 1) }; const sizes = [real(0, 1), real(0, 1)]; const p = real(0, 1); const q = real(0, 1);',
      7
    );
    const reordered = interpretDesign('const look = { y: real(0, 1), x: real(0, 1) };', 7);
    const look = one.look as { x: number; y: number };
    const sizes = one.sizes as number[];
    expect(look.x).not.toBe(look.y);
    expect(sizes[0]).not.toBe(sizes[1]);
    expect(one.p).not.toBe(one.q);
    expect(reordered.look).toEqual(one.look);
  });

  it('allows draws inside the object and array literals of a top-level const', () => {
    const design = interpretDesign(
      'const look = { cells: { shape: pick(["circle"]), size: real(1, 1) } }; const sizes = [int(2, 2)];',
      3
    );
    expect(design).toEqual({ look: { cells: { shape: 'circle', size: 1 } }, sizes: [2] });
  });

  it('validates draw arguments', () => {
    expect(() => interpretDesign('const a = int(5, 1);', 1)).toThrow(/minimum ≤ maximum/);
    expect(() => interpretDesign('const a = int(1.5, 3);', 1)).toThrow(/integers/);
    expect(() => interpretDesign('const a = pick([]);', 1)).toThrow(/non-empty array/);
  });

  it('numbers a repeated step label by its occurrence', () => {
    expect(
      interpretAlgorithm(
        'for (let i = Int(0); i < 3; i++) yield "Compare"; yield "Compare (2)";'
      ).map(({ label }) => label)
    ).toEqual(['Compare', 'Compare (2)', 'Compare (3)', 'Compare (2) (2)']);
  });
});

describe('domain types', () => {
  it('rejects plain values in the input, naming where they are and how to type them', () => {
    expect(() => interpretInput('const n = 8;')).toThrow(
      'n would be the plain number 8, but input and algorithm values must have a domain type. Write it as Int(8) or Real(8)'
    );
    expect(() => interpretTypedInput('const n = 3;')).toThrow(
      "Declare a type that says what it means in the domain block, such as const Count = type('integer');, and write Count(3)."
    );
    // Collections and records made by their types are fine.
    expect(interpretInput('const empty = Ints([]); const grid = Grid([[1]]);').state).toEqual({
      empty: [],
      grid: [[1]]
    });
  });

  it('rejects plain values the algorithm stores, at the statement that stores them', () => {
    expect(() => interpretAlgorithm('let i = 0; yield "A";')).toThrow(
      /i would be the plain number 0/
    );
    expect(() => interpretAlgorithm('const s = Ints([]); s.push("x"); yield "A";')).toThrow(
      /an item added by s\.push\(\): Int values must be whole numbers, not "x"/
    );
    // Plain literals in expressions are fine when the result keeps its type.
    expect(
      interpretAlgorithm('let i = Int(0); i = i + 1; i += 2; i++; yield "A";')[0].types
    ).toEqual({ i: 'Int' });
  });

  it('keeps each variable the type it was made with, converting what is assigned to it', () => {
    const step = interpretAlgorithm(
      'const d = Ints([0, 1]); let n = Int(0); n = d.length; let found = Flag(false); found = 1 < 2; yield "A";'
    )[0];
    expect(step.state).toMatchObject({ n: 2, found: true });
    expect(step.types).toMatchObject({ n: 'Int', found: 'Flag' });
    const body = 'let found = Flag(false);\nyield "A";\nfound = Text("yes");';
    expect(() => interpretAlgorithm(body)).toThrow(
      expect.objectContaining({
        offset: body.indexOf('found = Text'),
        message: expect.stringMatching(/^found must be a Flag, not a Text/u)
      })
    );
    expect(() => interpretAlgorithm('let h = Int(7); h = h / Int(2); yield "A";')).toThrow(
      /h: Int values must be whole numbers, not 3\.5/
    );
  });

  it('has no null: every place holds a value of its type', () => {
    expect(() => interpretInput('const none = null;')).toThrow(/There is no null/);
    expect(() => interpretAlgorithm('let x; yield "A";')).toThrow(/Give x a starting value/);
    expect(() => interpretAlgorithm('const s = Ints([]); const x = s.pop(); yield "A";')).toThrow(
      /x would have no value: it was taken from an empty collection/
    );
    expect(() =>
      interpretAlgorithm('const s = Ints([]); let x = Int(0); x = s.pop(); yield "A";')
    ).toThrow(/x would have no value.*an Int is needed here|x would have no value/);
    expect(() => interpretAlgorithm('const x = undefined; yield "A";')).toThrow(
      /"undefined" is not defined/
    );
  });
});
