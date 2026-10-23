import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Front = ref(Values);
`);
const run = (body: string) => interpretAlgorithm(body, undefined, domain);

/** Where the element a reference refers to is at each step, by the path holding its identity. */
const whereIs = (body: string, name: string) =>
  run(body).map(({ identities }) => {
    const id = identities?.refs[name];
    return id === undefined
      ? undefined
      : Object.keys(identities!.ids).find(
          (path) => identities!.ids[path] === id && path.endsWith(']')
        );
  });

describe('references', () => {
  it('stay with their element as it moves, and read as it', () => {
    const trace = run(`
      @start[const queue = Values([4, 7, 9]);
      const front = Front(queue[1]);]
      @leave[queue.shift();]
    `);
    expect(trace.map(({ state }) => state.front)).toEqual([7, 7]);
    expect(trace[0].types.front).toBe('Front');
    expect(
      whereIs(
        `@start[const queue = Values([4, 7, 9]); const front = Front(queue[1]);] @leave[queue.shift();]`,
        'front'
      )
    ).toEqual(['queue[1]', 'queue[0]']);
  });

  it('refer to nothing once their element is gone', () => {
    expect(
      whereIs(
        `@start[const queue = Values([4, 7]); const front = Front(queue[0]);] @leave[queue.shift();]`,
        'front'
      )
    ).toEqual(['queue[0]', undefined]);
  });

  it('follow the original of a copied value, not the copy', () => {
    expect(
      whereIs(
        `@start[const values = Values([5, 2]); const r = Front(values[0]);] @copy[values[1] = values[0];]`,
        'r'
      )
    ).toEqual(['values[0]', 'values[0]']);
  });

  it('are made from an element of a collection of their type', () => {
    expect(() => run(`const values = Values([5]); const r = Front(Int(5));`)).toThrow(
      'A Front refers to an element of a Values, so make it from one, as in Front(values[0]).'
    );
  });

  it.each([
    [
      'a type that is not a collection',
      'const Int = type([1]); const R = ref(Int);',
      /Int is not one/
    ],
    [
      'a collection of records',
      'const Int = type([1]); const Pair = record({ a: Int }); const Pairs = collection(Pair); const R = ref(Pairs);',
      /ref\(\) refers to elements that are single values, and Pairs holds Pairs/
    ]
  ])('are defined in the domain, rejecting %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});

describe('references to positions', () => {
  it('refer to the element of their collection, not a field holding the same value', () => {
    const graph = interpretDomain(`
      const Name = type(['A', 'B', 'C']);
      const Names = collection(Name);
      const Vertex = index(Names);
      const Edge = record({ from: Vertex, to: Vertex });
      const Edges = collection(Edge);
      const Queue = collection(Vertex);
      const Front = ref(Queue);
    `);
    const [step] = interpretAlgorithm(
      `const vertices = Names(['A', 'B', 'C']);
       const edges = Edges([{ from: 0, to: 2 }]);
       let queue = Queue([]);
       queue.push(edges[0].to);
       const front = Front(queue[0]);`,
      undefined,
      graph
    );
    expect(step.identities?.refs.front).toBe(step.identities?.ids['queue[0]']);
  });
});
