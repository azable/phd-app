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
  it('point into the only collection of their type', () => {
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

  it('hold any whole number, however far past an end', () => {
    const trace = run(`
      const values = Values([3, 8, 5]);
      let i = Position(-2);
      yield;
      for (i = Position(0); i < values.length; i += 2) yield;
      yield;
      i = 50;
      i = 0;
      yield;
    `);
    expect(trace.map(({ state }) => state.i)).toEqual([-2, 0, 2, 4, 0]);
    const [far] = run('const values = Values([3, 8, 5]); let i = Position(0); i = 7; yield;');
    expect(far.state.i).toBe(7);
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
    expect(interpretAlgorithm('i = 1; yield;', input, domain)[0].targets).toEqual({ i: 'right' });
  });

  describe('keep their collection wherever they are stored', () => {
    const stored = interpretDomain(`
      const Int = type('integer', { min: 0, max: 9 });
      const Values = collection(Int);
      const Position = index(Values);
      const Positions = collection(Position);
      const Take = record({ from: Position });
    `);

    it('in records, collections, and the variables made from them', () => {
      const [step] = interpretAlgorithm(
        `
        const left = Values([1, 4]);
        const right = Values([2, 3]);
        let i = Position(left, 1);
        let j = Position(right, 0);
        const take = Take({ from: j });
        const seen = Positions([i, j + 1, Position(right, 0)]);
        let k = Position(left, 0);
        k = j;
        const moved = take.from;
        yield;
      `,
        undefined,
        stored
      );
      expect(step.targets).toEqual({
        i: 'left',
        j: 'right',
        'take.from': 'right',
        'seen[0]': 'left',
        'seen[1]': 'right',
        'seen[2]': 'right',
        // A variable keeps its own collection; one declared from a stored position takes its.
        k: 'left',
        moved: 'right'
      });
    });

    it('from the input into the algorithm', () => {
      const input = interpretInput(
        `const left = Values([1]); const right = Values([2, 3]);
         const take = Take({ from: Position(right, 1) });`,
        stored
      );
      const [step] = interpretAlgorithm('const at = take.from; yield;', input, stored);
      expect(step.targets).toMatchObject({ 'take.from': 'right', at: 'right' });
    });

    it('asking which collection a number stored with several to point into means', () => {
      expect(() =>
        interpretAlgorithm(
          'const left = Values([1]); const right = Values([2]); const take = Take({ from: 0 }); yield;',
          undefined,
          stored
        )
      ).toThrow('Take.from could point into left or right; say which, as in Position(left, 0).');
    });
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
      'reading outside the collection',
      'const values = Values([3, 8]); let i = Position(0); i = 2; const x = values[i]; yield;',
      'values[i] is outside the collection: it has 2 elements, at 0 to 1.'
    ],
    [
      'writing past its length',
      'const values = Values([3, 8]); let i = Position(0); i = 3; values[i] = 1; yield;',
      'values[i] is outside the collection: it has 2 elements, so write at 0 to 2, where 2 adds one.'
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
      'options',
      'const One = type([1]); const Ints = collection(One); const P = index(Ints, { reach: 2 });',
      /index\(\) takes one collection type/
    ]
  ])('are defined in the domain, rejecting %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});
