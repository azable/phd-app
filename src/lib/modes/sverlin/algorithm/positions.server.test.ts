import { describe, expect, it } from 'vitest';

import {
  interpretAlgorithm,
  interpretDomain,
  interpretInput,
  traceAlgorithm,
  type Pacing
} from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Name = type(['A', 'B', 'C']);
  const Names = array(Name, { max: 8 });
  const VertexRef = index(Names);
  const Weight = type('integer', { min: 0, max: 9 });
  const Edge = record({ from: VertexRef, to: VertexRef, weight: Weight });
  const Edges = array(Edge, { max: 8 });
  const Flag = type('boolean');
`);
const run = (body: string, pacing?: Pacing) =>
  traceAlgorithm(body, undefined, domain, pacing).steps;

describe('positions', () => {
  it('point into the only collection of their type', () => {
    const trace = run(`
      @start[const values = Values([3, 8, 5]);
      let i = Position(-1);]
      @zero[i = Position(0);]
      while ((i < values.length)) {
        @up[i++;]
      }
    `);
    // The loop's last test, after the last i++, changes nothing, so it is no step.
    expect(trace.map(({ state }) => state.i)).toEqual([-1, 0, 1, 2, 3]);
    expect(trace[0].types.i).toBe('Position');
  });

  it('name their collection when there are several, and combine across collections', () => {
    const trace = run(
      `
      @start[const left = Values([1, 4]);
      const right = Values([2, 3]);
      let merged = Values([]);
      let i = Position(left, 0);
      let j = Position(right, 0);
      let k = Position(merged, -1);]
      while ((i < left.length) && (j < right.length)) {
        @take[if ((left[i] < right[j])) { merged.push(left[i]); i++; } else { merged.push(right[j]); j++; }]
        @count[k = i + j - 1;]
      }
    `,
      { pauses: new Set(['start', 'count']) }
    );
    // Pausing at the start and each count; the loop's last test changes nothing,
    // so the last count is the last step.
    expect(trace.map(({ state }) => state.merged)).toEqual([[], [1], [1, 2], [1, 2, 3]]);
    expect(trace.at(-1)?.state).toMatchObject({ i: 1, j: 2, k: 2 });
  });

  it('hold a whole number from one before the start to their collection type’s max', () => {
    const trace = run(`
      @start[const values = Values([3, 8, 5]);
      let i = Position(-1);]
      @zero[i = Position(0);]
      while ((i < values.length)) {
        @up[i = i + 2;]
      }
      @far[i = 8;
      i = 0;]
    `);
    expect(trace.map(({ state }) => state.i)).toEqual([-1, 0, 2, 4, 0]);
    expect(() => run('const values = Values([3, 8, 5]); let i = Position(-2);')).toThrow(
      /at least -1/
    );
    expect(() => run('const values = Values([3, 8, 5]); let i = Position(0); i = 9;')).toThrow(
      /at most 8/
    );
    // A sum of positions on the way to one is no position until it is held as one.
    const [middle] = run(
      'const values = Values([1, 2, 3, 4, 5, 6, 7, 8]); const lo = Position(6); const hi = Position(7); const mid = Position(Math.floor((lo + hi) / 2));'
    );
    expect(middle.state.mid).toBe(6);
  });

  it('come from collections that never hold more than their type’s max', () => {
    const nine = '[1, 2, 3, 4, 5, 6, 7, 8, 9]';
    expect(() => run(`const values = Values(${nine});`)).toThrow(
      'Values holds at most 8 elements, and Values([…]) would hold 9: give Values a larger max, as array(Int, { max: 9 }).'
    );
    expect(() => run('const values = Values.ofLength(9, Int(0));')).toThrow(
      /Values\.ofLength\(9, …\) would hold 9/
    );
    expect(() => run('const values = Values.ofLength(8, Int(0)); values.push(Int(1));')).toThrow(
      /values would hold 9/
    );
    expect(() => run('const values = Values.ofLength(8, Int(0)); values.unshift(Int(1));')).toThrow(
      /values would hold 9/
    );
  });

  it('record the collection each one points into at every step', () => {
    const [step] = run(`
      const left = Values([1]);
      const right = Values([2]);
      let i = Position(right, 0);
      const vertices = Names(['A', 'B']);
      const edges = Edges([{ from: 0, to: 1, weight: 4 }]);
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
    expect(interpretAlgorithm('', input, domain)[0].targets).toEqual({ i: 'right' });
    expect(interpretAlgorithm('i = 1;', input, domain)[0].targets).toEqual({ i: 'right' });
  });

  describe('keep their collection wherever they are stored', () => {
    const stored = interpretDomain(`
      const Int = type('integer', { min: 0, max: 9 });
      const Values = array(Int, { max: 8 });
      const Position = index(Values);
      const Positions = array(Position, { max: 8 });
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
        const seen = Positions([i, (j + 1), Position(right, 0)]);
        let k = Position(left, 0);
        k = j;
        const moved = take.from;
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
      const [step] = interpretAlgorithm('const at = take.from;', input, stored);
      expect(step.targets).toMatchObject({ 'take.from': 'right', at: 'right' });
    });

    it('asking which collection a number stored with several to point into means', () => {
      expect(() =>
        interpretAlgorithm(
          'const left = Values([1]); const right = Values([2]); const take = Take({ from: 0 });',
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
    `);
    expect(step.state.edges).toEqual([{ from: 0, to: 2, weight: 4 }]);
    expect(step.types['edges[0].from']).toBe('VertexRef');
  });

  it.each([
    [
      'reading outside the collection',
      'const values = Values([3, 8]); let i = Position(0); i = 2; const x = values[i];',
      'values[i] is outside the array: it has 2 elements, at 0 to 1.'
    ],
    [
      'writing past its length',
      'const values = Values([3, 8]); let i = Position(0); i = 3; values[i] = 1;',
      'values[i] is outside the array: it has 2 elements, so write at 0 to 2, where 2 adds one.'
    ],
    [
      'more than one collection to point into',
      'const left = Values([1]); const right = Values([2]); let i = Position(0);',
      'i could point into left or right; say which, as in Position(left, 0).'
    ],
    [
      'no collection to point into',
      'let i = Position(0);',
      'i is a Position, which points into a Values, and there is none yet; declare one first.'
    ],
    [
      'naming something other than its collection',
      'const values = Values([1]); const n = Int(1); let i = Position(n, 0);',
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
    ['no type', 'const P = index();', /index\(\) takes one array type/],
    [
      'options',
      'const One = type([1]); const Ints = array(One, { max: 8 }); const P = index(Ints, { reach: 2 });',
      /index\(\) takes one array type/
    ]
  ])('are defined in the domain, rejecting %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});
