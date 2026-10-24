import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const domain = interpretDomain(`
  const Vertex = type([0, 1, 2, 3]);
  const Weight = type([4, 5, 7]);
  const Distance = type('integer', { min: 0, max: 1000 });
  const Unreached = type(['unreached']);
  const Count = type('integer', { min: -100, max: 1000 });
  const Dist = union(Distance, Unreached);
  const Edge = record({ from: Vertex, to: Vertex, weight: Weight });
  const Edges = collection(Edge);
  const Distances = collection(Dist);
  const Queue = collection(Vertex);
  const Either = union(Distance, Count);
  const IsReached = unop(Dist, (d) => Count(d !== Unreached('unreached') ? 1 : 0));
  const IsUnreached = unop(Dist, (d) => Count(d === Unreached('unreached') ? 1 : 0));
  const Order = binop(Dist, Dist, (a, b) => Count(a < b ? 1 : 0));
  const Bump = unop(Weight, (w) => Weight(w + 1));
  const Double = unop(Weight, (w) => Weight(w + w));
  const Twice = unop(Weight, (w) => Distance(Distance(w) + Distance(w)));
`);

/** Run an algorithm with the test domain from an input block, and return its last step. */
function last(algorithm: string, input = '') {
  const trace = interpretAlgorithm(algorithm, interpretInput(input, domain), domain);
  return trace[trace.length - 1];
}

describe('union, record, and collection definitions', () => {
  it('defines each from types defined before it', () => {
    expect(domain.structures.Dist).toEqual({
      kind: 'union',
      name: 'Dist',
      members: ['Distance', 'Unreached']
    });
    expect(domain.structures.Edge).toEqual({
      kind: 'record',
      name: 'Edge',
      fields: { from: 'Vertex', to: 'Vertex', weight: 'Weight' }
    });
    expect(domain.structures.Edges).toEqual({ kind: 'collection', name: 'Edges', element: 'Edge' });
  });

  it.each([
    ['unknown members', 'const A = union(B, C);', /Unknown type B/],
    [
      'types defined later',
      'const A = collection(B); const B = type("integer", { min: -100, max: 1000 });',
      /Unknown type B/
    ],
    [
      'one-member unions',
      'const B = type("integer", { min: -100, max: 1000 }); const A = union(B);',
      /two or more/
    ],
    [
      'unions of unions',
      'const B = type("integer", { min: -100, max: 1000 }); const C = type(["c"]); const U = union(B, C); const A = union(U, B);',
      /not other unions/
    ],
    ['records without fields', 'const A = record({});', /at least one field/],
    ['record fields that are not types', 'const A = record({ x: 3 });', /must name a type/],
    [
      'collections of several types',
      'const B = type("integer", { min: -100, max: 1000 }); const A = collection(B, B);',
      /one element type/
    ],
    [
      'refining a record',
      'const B = type("integer", { min: -100, max: 1000 }); const R = record({ b: B }); const A = type(R);',
      /refines an atomic type/
    ]
  ])('rejects %s', (_name, body, message) => {
    expect(() => interpretDomain(body)).toThrow(message);
  });
});

describe('values made by collection and record types', () => {
  it('types literals by their context, and records container types by path', () => {
    const input = interpretInput('const edges = Edges([{ from: 0, to: 1, weight: 4 }]);', domain);
    expect(input.state.edges).toEqual([{ from: 0, to: 1, weight: 4 }]);
    expect(input.types).toEqual({
      edges: 'Edges',
      'edges[0]': 'Edge',
      'edges[0].from': 'Vertex',
      'edges[0].to': 'Vertex',
      'edges[0].weight': 'Weight'
    });
  });

  it('carries collections and records from the input into the algorithm', () => {
    const step = last(
      'const e = edges[0]; e.weight = 7; edges.push({ from: 1, to: 2, weight: 5 }); const part = edges.slice(1);',
      'const edges = Edges([{ from: 0, to: 1, weight: 4 }]);'
    );
    expect(step.state.edges).toEqual([
      { from: 0, to: 1, weight: 7 },
      { from: 1, to: 2, weight: 5 }
    ]);
    expect(step.types).toMatchObject({
      edges: 'Edges',
      e: 'Edge',
      part: 'Edges',
      'part[0]': 'Edge'
    });
  });

  it.each([
    ['missing fields', 'const e = Edge({ from: 0, to: 1 });', /needs weight, a Weight/],
    [
      'unknown fields',
      'const e = Edge({ from: 0, to: 1, weight: 4, colour: 1 });',
      /has no field colour/
    ],
    [
      'values outside a field’s type',
      'const e = Edge({ from: 0, to: 9, weight: 4 });',
      /Edge\.to: 9 is not a Vertex/
    ],
    [
      'elements of the wrong type',
      'const q = Queue([Weight(4)]);',
      /must be a Vertex, not a Weight/
    ],
    [
      'reading unknown fields',
      'const e = Edge({ from: 0, to: 1, weight: 4 }); const x = e.colour;',
      /has no field colour/
    ],
    [
      'writing unknown fields',
      'const e = Edge({ from: 0, to: 1, weight: 4 }); e.colour = Count(1);',
      /has no field colour/
    ],
    [
      'one collection as another',
      'const q = Queue([1]); const d = Distances(q);',
      /must be a Distances, not a Queue/
    ],
    ['plain arrays', 'const q = [Vertex(1)];', /Arrays are made by a collection type/],
    ['plain objects', 'const e = { from: Vertex(1) };', /Objects are made by a record type/]
  ])('rejects %s', (_name, statement, message) => {
    expect(() => last(`${statement}`)).toThrow(message);
  });

  it('converts what is pushed or assigned into a collection to its element type', () => {
    const step = last('const q = Queue([]); q.push(1); q.unshift(0); q[2] = 3;');
    expect(step.state.q).toEqual([0, 1, 3]);
    expect(step.types).toMatchObject({ 'q[0]': 'Vertex', 'q[1]': 'Vertex', 'q[2]': 'Vertex' });
    expect(() => last('const q = Queue([]); q.push(9);')).toThrow(/9 is not a Vertex/);
  });
});

describe('unions', () => {
  it('makes a literal the one member it fits, and keeps a typed value’s own member', () => {
    const step = last('const d = Distances([0, "unreached", Distance(4)]);');
    expect(step.types).toMatchObject({
      d: 'Distances',
      'd[0]': 'Distance',
      'd[1]': 'Unreached',
      'd[2]': 'Distance'
    });
    expect(() => last('const d = Either(3);')).toThrow(/could be a Distance or a Count/);
    expect(() => last('const d = Distances([Count(3)]);')).toThrow(
      /must be a Distance or Unreached, not a Count value/
    );
  });

  it('declares a variable made by a union as the union, so it can hold either member', () => {
    const step = last("let d = Dist(0); d = 'unreached';");
    expect(step.types.d).toBe('Unreached');
    expect(() => last('let d = Dist(0); d = Count(3);')).toThrow(
      /d must be a Distance or Unreached, not a Count value/
    );
    // A variable made by a member keeps that member's type.
    expect(() => last("let d = Distance(0); d = 'unreached';")).toThrow(
      /Distance values must be whole numbers/
    );
    // The input's declared types carry into the algorithm.
    expect(last("d = 'unreached';", 'const d = Dist(0);').types.d).toBe('Unreached');
  });

  it('compares members with === and !==, but not by order', () => {
    const step = last(`
      const d = Distances([0, "unreached"]);
      const reached = IsReached(d[0]);
      const unreached = IsUnreached(d[1]);
    `);
    expect(step.state).toMatchObject({ reached: 1, unreached: 1 });
    expect(() =>
      last('const d = Distances([0, "unreached"]); const x = Order(d[0], d[1]);')
    ).toThrow(/cannot be combined/);
  });
});

describe('enumerations in arithmetic', () => {
  it('keeps the type, and fails when the result is not one of its values', () => {
    const step = last('const w = Bump(Weight(4));');
    expect(step.state.w).toBe(5);
    expect(step.types.w).toBe('Weight');
    expect(() => last('const w = Double(Weight(4));')).toThrow(
      '8 is not a Weight; allowed values are 4, 5, 7.'
    );
  });

  it('converts to a numeric type of the same kind', () => {
    const step = last(`
      const e = Edge({ from: 0, to: 1, weight: 7 });
      const d = Twice(e.weight);
    `);
    expect(step.state.d).toBe(14);
    expect(step.types.d).toBe('Distance');
  });
});
