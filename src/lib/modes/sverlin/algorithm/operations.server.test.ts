import { describe, expect, it } from 'vitest';

import { AlgorithmError } from './block.server';
import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
  const Swap = operation({ a: Index, b: Index }, ({ a, b }) => {
    const moved = a.value;
    a.value = b.value;
    b.value = moved;
  });
  const Less = operation({ a: Index, b: Index }, ({ a, b }) => a.value < b.value);
  const Order = operation({ a: Index, b: Index }, ({ a, b }) => {
    if (Less({ a: b, b: a })) {
      Swap({ a, b });
      return true;
    }
    return false;
  });
`);
const run = (body: string, input?: string) =>
  interpretAlgorithm(body, input ? interpretInput(input, domain) : undefined, domain);

describe('operations', () => {
  it('are called with their operands, returning what their body gives', () => {
    const trace = run(
      `
      let found = Index(-1);
      for (let i = Index(0); i < values.length; i++) {
        if (Matches({ at: i, target })) { found = i; break; }
      }
      yield;
    `,
      'const values = Values([3, 8, 5, 2]); const target = Int(5);'
    );
    expect(trace[0].state.found).toBe(2);
  });

  it('record the calls since the last step as its event, and every call by operation', () => {
    const trace = run(
      `
      for (let i = Index(0); i < values.length; i++) {
        if (Matches({ at: i, target })) break;
        yield;
      }
      yield;
    `,
      'const values = Values([3, 8, 5]); const target = Int(5);'
    );
    expect(trace.map(({ state }) => (state.event as Record<string, unknown>).Matches)).toEqual([
      [{ at: 0, target: 5 }],
      [{ at: 1, target: 5 }],
      [{ at: 2, target: 5 }]
    ]);
    expect(trace[0].state.event).toMatchObject({ Swap: [], Less: [], Order: [] });
    expect(trace[2].state.history).toEqual({
      Matches: [
        { at: 0, target: 5 },
        { at: 1, target: 5 },
        { at: 2, target: 5 }
      ],
      Swap: [],
      Less: [],
      Order: []
    });
    expect(trace[0].types).toMatchObject({
      'event.Matches[0]': 'Matches',
      'event.Matches[0].at': 'Index',
      'history.Matches[0]': 'Matches'
    });
    expect(trace[0].targets).toMatchObject({ 'event.Matches[0].at': 'values' });
  });

  it('write through their operands, and nest', () => {
    const [step] = run(
      'Order({ a: Index(0), b: Index(1) }); Order({ a: Index(1), b: Index(2) }); yield;',
      'const values = Values([3, 1, 2]);'
    );
    expect(step.state.values).toEqual([1, 2, 3]);
    expect(step.state.event).toEqual({
      Matches: [],
      Swap: [
        { a: 0, b: 1 },
        { a: 1, b: 2 }
      ],
      Less: [
        { a: 1, b: 0 },
        { a: 2, b: 1 }
      ],
      Order: [
        { a: 0, b: 1 },
        { a: 1, b: 2 }
      ]
    });
  });

  it('read and write the element a position points at as its value, in the algorithm too', () => {
    const [step] = run(
      'let i = Index(1); i.value = Int(7); const seen = i.value; yield;',
      'const values = Values([3, 8]);'
    );
    expect(step.state).toMatchObject({ values: [3, 7], seen: 7 });
  });

  it('leave sources without operations recording no event or history', () => {
    const plain = interpretDomain("const Int = type('integer', { min: 0, max: 9 });");
    const [step] = interpretAlgorithm('const n = Int(1); yield;', undefined, plain);
    expect(step.state).toEqual({ n: 1 });
  });

  it.each([
    [
      'operands not given as one object',
      'const values = Values([1]); Matches(Index(0), Int(1)); yield;',
      'Matches(...) takes its operands as one object, as in Matches({ at, target }).'
    ],
    [
      'a missing operand',
      'const values = Values([1]); Matches({ at: Index(0) }); yield;',
      'Matches needs target, a Int.'
    ],
    [
      'reading past the end through a position',
      'const values = Values([1]); Matches({ at: Index(3), target: Int(1) }); yield;',
      'at.value is outside the collection: it has 1 element, at 0 to 0.'
    ]
  ])('reject %s', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it('report a problem in a body in the domain block', () => {
    try {
      run('const values = Values([1]); Matches({ at: Index(3), target: Int(1) }); yield;');
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(AlgorithmError);
      expect((cause as AlgorithmError).block).toBe('domain');
    }
  });

  it.each([
    [
      'a body that does not take its operands by name',
      'const Int = type([1]); const Same = operation({ a: Int }, (x) => x);',
      'The body of Same takes its operands by name, as ({ a }) => ….'
    ],
    [
      'no body',
      'const Int = type([1]); const Same = operation({ a: Int });',
      'operation() takes its operands and their types, then a function of them'
    ],
    [
      'an operation as a type of values',
      'const Int = type([1]); const Same = operation({ a: Int }, ({ a }) => a); const Pair = record({ s: Same });',
      'Same is an operation, which is called, not a type values have.'
    ],
    [
      'a body that yields',
      'const Int = type([1]); const Same = operation({ a: Int }, ({ a }) => { yield; });',
      "The keyword 'yield' is reserved"
    ],
    [
      'a function anywhere else',
      'const Int = type([1]); const f = type(() => 1);',
      'Functions are not supported here'
    ]
  ])('are defined in the domain, rejecting %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });

  it('are called only in the algorithm', () => {
    expect(() =>
      interpretInput('const values = Values([1]); const m = Matches({ at: 0, target: 1 });', domain)
    ).toThrow('Matches(...) is an operation, which the algorithm calls.');
  });

  it('reserve event and history for the steps', () => {
    expect(() => run('const event = Int(1); yield;')).toThrow('"event" is reserved for the view.');
  });
});
