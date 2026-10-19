import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Name = type(['A', 'B', 'C']);
  const Names = collection(Name);
  const VertexRef = index(Names);
  const Weight = type('integer', { min: 0, max: 9 });
  const Edge = record({ from: VertexRef, to: VertexRef, weight: Weight });
  const Edges = collection(Edge);
`);
const run = (body: string) => interpretAlgorithm(body, undefined, domain);

describe('positions', () => {
  it('point into the only collection of their type, from -1 to its length', () => {
    const trace = run(`
      const values = Values([3, 8, 5]);
      let i = Position(-1);
      yield;
      for (i = Position(0); i < values.length; i++) yield;
      yield;
    `);
    expect(trace.map(({ state }) => state.i)).toEqual([-1, 0, 1, 2, 3]);
    expect(trace[0].types.i).toBe('Position');
  });

  it('name their collection when there are several, and combine across collections', () => {
    const trace = run(`
      const left = Values([1, 4]);
      const right = Values([2, 3]);
      let merged = Values([]);
      let i = Position(left, 0);
      let j = Position(right, 0);
      let k = Position(merged, -1);
      while (i < left.length && j < right.length) {
        if (left[i] < right[j]) { merged.push(left[i]); i++; } else { merged.push(right[j]); j++; }
        k = i + j - 1;
        yield;
      }
    `);
    expect(trace.map(({ state }) => state.merged)).toEqual([[1], [1, 2], [1, 2, 3]]);
    expect(trace.at(-1)?.state).toMatchObject({ i: 1, j: 2, k: 2 });
  });

  it('step as far past each end as their reach', () => {
    const reaching = interpretDomain(`
      const Letter = type(['a', 'b', 'c']);
      const Letters = collection(Letter);
      const Position = index(Letters, { reach: 2 });
    `);
    expect(reaching.atoms.Position.min).toBe(-2);
    const trace = interpretAlgorithm(
      `const letters = Letters(['a', 'b', 'c']);
       let i = Position(-2);
       yield;
       for (i = Position(0); i < letters.length; i += 2) yield;
       yield;`,
      undefined,
      reaching
    );
    expect(trace.map(({ state }) => state.i)).toEqual([-2, 0, 2, 4]);
    expect(() =>
      interpretAlgorithm(
        `const letters = Letters(['a', 'b', 'c']); let i = Position(0); i = 5; yield;`,
        undefined,
        reaching
      )
    ).toThrow('a Position goes from -2 to 4 and only 0 to 2 point at an element.');
  });

  it('record the collection each one points into at every step', () => {
    const [step] = run(`
      const left = Values([1]);
      const right = Values([2]);
      let i = Position(right, 0);
      const vertices = Names(['A', 'B']);
      const edges = Edges([{ from: 0, to: 1, weight: 4 }]);
      yield;
    `);
    expect(step.targets).toEqual({
      i: 'right',
      'edges[0].from': 'vertices',
      'edges[0].to': 'vertices'
    });
  });

  it('keep the collection an input position names in the algorithm', () => {
    const input = interpretInput(
      'const left = Values([1, 2, 3]); const right = Values([4]); let i = Position(right, 0);',
      domain
    );
    expect(interpretAlgorithm('yield;', input, domain)[0].targets).toEqual({ i: 'right' });
    expect(() => interpretAlgorithm('i = 2; yield;', input, domain)).toThrow('outside right');
  });

  it('point into the only collection of their type from records', () => {
    const [step] = run(`
      const vertices = Names(['A', 'B', 'C']);
      const edges = Edges([{ from: 0, to: 2, weight: 4 }]);
      yield;
    `);
    expect(step.state.edges).toEqual([{ from: 0, to: 2, weight: 4 }]);
    expect(step.types['edges[0].from']).toBe('VertexRef');
  });

  it.each([
    [
      'leaving the collection',
      'const values = Values([3, 8]); let i = Position(0); i = 3; yield;',
      'i is 3, outside values: a Position goes from -1 to 2, its length, and only 0 to 1 point at an element. To step further past an end, give it a reach, as in index(Values, { reach: 2 }).'
    ],
    [
      'more than one collection to point into',
      'const left = Values([1]); const right = Values([2]); let i = Position(0); yield;',
      'i could point into left or right; say which, as in Position(left, 0).'
    ],
    [
      'no collection to point into',
      'let i = Position(0); yield;',
      'i is a Position, which points into a Values, and there is none yet; declare one first.'
    ],
    [
      'naming something other than its collection',
      'const values = Values([1]); const n = Int(1); let i = Position(n, 0); yield;',
      'Position(…, …) names the Values it points into first, as in Position(values, 0).'
    ],
    [
      'a record pointing outside its collection',
      'const vertices = Names(["A"]); const edges = Edges([{ from: 3, to: 0, weight: 1 }]); yield;',
      'Edges[0].from is 3, outside vertices'
    ]
  ])('reject %s', (_name, body, message) => {
    expect(() => run(body)).toThrow(message);
  });

  it.each([
    [
      'a type that is not a collection',
      'const Int = type([1]); const P = index(Int);',
      /Int is not one/
    ],
    ['no type', 'const P = index();', /index\(\) takes one collection type/],
    [
      'a reach that is not a small whole number',
      'const One = type([1]); const Ints = collection(One); const P = index(Ints, { reach: 9 });',
      /index\(\) options are \{ reach: n \}.*from 1 to 4/
    ],
    [
      'other options',
      'const One = type([1]); const Ints = collection(One); const P = index(Ints, { overflow: true });',
      /index\(\) options are \{ reach: n \}/
    ]
  ])('are defined in the domain, rejecting %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});
