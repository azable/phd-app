import { describe, expect, it } from 'vitest';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Name = type(['A', 'B', 'C', 'D']);
  const Flag = type('boolean');
  const End = type(['end']);
  const Node = record({ name: Name, next: Next });
  const Nodes = pool(Node, { max: 4 });
  const NodeRef = ref(Node);
  const Next = union(NodeRef, End);
`);

const list = `const nodes = Nodes();
const head = NodeRef(nodes.add(Node({ name: 'A', next:
  nodes.add(Node({ name: 'B', next: nodes.add(Node({ name: 'C', next: End('end') })) })) })));`;

// Showing each test for a node, as a view of IsNode rendered at a label around it all would.
const run = (algorithm: string, input = list) =>
  traceAlgorithm(algorithm, interpretInput(input, domain), domain, {
    shown: new Map([['IsNode', [{ start: 0, end: Infinity }]]])
  }).steps;

describe('pools and references', () => {
  it('records a pool under its variable, in the order added, and a reference as its place there', () => {
    const input = interpretInput(list, domain);
    // The innermost node is added first.
    expect(input.state.nodes).toEqual([
      { name: 'C', next: 'end' },
      { name: 'B', next: 0 },
      { name: 'A', next: 1 }
    ]);
    expect(input.types.nodes).toBe('Nodes');
    expect(input.state.head).toBe(2);
    expect(input.types.head).toBe('NodeRef');
    expect(input.targets?.head).toBe('nodes');
    expect(input.types['nodes[1].next']).toBe('NodeRef');
    expect(input.targets?.['nodes[1].next']).toBe('nodes');
    expect(input.types['nodes[0].next']).toBe('End');
  });

  it('reverses a list through its references', () => {
    const steps = run(`
      let prev = Next(End('end'));
      let cur = Next(head);
      while ((cur !== 'end')) @rewire{
        const after = cur.next;
        cur.next = prev;
        prev = cur;
        cur = after;
      }
    `);
    const last = steps.at(-1)!;
    expect(last.state.nodes).toEqual([
      { name: 'C', next: 1 },
      { name: 'B', next: 2 },
      { name: 'A', next: 'end' }
    ]);
    expect(last.state.prev).toBe(0);
    expect(last.state.cur).toBe('end');
    // The nodes keep their identities as their links change.
    const ids = (step: (typeof steps)[number]) =>
      [0, 1, 2].map((index) => step.identities?.ids[`nodes[${index}]`]);
    expect(ids(last)).toEqual(ids(steps[0]));
  });

  it('adds nodes in the algorithm, keeping every one, up to the pool’s max', () => {
    const empty = `const nodes = Nodes();`;
    const steps = run(
      `
      let first = Next(End('end'));
      @push[first = nodes.add(Node({ name: Name('D'), next: first }));
      first = nodes.add(Node({ name: Name('C'), next: first }));]
      @drop[first = first.next;]
    `,
      empty
    );
    const kept = [
      { name: 'D', next: 'end' },
      { name: 'C', next: 0 }
    ];
    expect(steps.at(-2)!.state.nodes).toEqual(kept);
    expect(steps.at(-1)!.state.nodes).toEqual(kept);
    expect(() =>
      run(`${"nodes.add(Node({ name: Name('A'), next: End('end') }));".repeat(5)}`, empty)
    ).toThrow(
      'Nodes holds at most 4 elements, and another .add(…) would hold 5: give Nodes a larger max, as pool(Node, { max: 5 }).'
    );
  });

  it('records a pool inside a call that takes it, under the input’s name for it', () => {
    const steps = run(
      `
      function grow(pool, n) @grow{
        @adding[const made = pool.add(Node({ name: Name('D'), next: n }));]
      }
      @go[grow(nodes, head);]
    `
    );
    const inside = steps.find((step) => 'made' in step.state)!;
    expect(inside.state.nodes).toHaveLength(4);
    expect(inside.state.made).toBe(3);
    expect(inside.targets?.made).toBe('nodes');
  });

  it('keeps a circular list finite, and takes an input with a variable for each node', () => {
    const steps = run(
      `@close[c.next = a;]`,
      `const nodes = Nodes();
      const c = NodeRef(nodes.add(Node({ name: 'C', next: End('end') })));
      const b = NodeRef(nodes.add(Node({ name: 'B', next: c })));
      const a = NodeRef(nodes.add(Node({ name: 'A', next: b })));`
    );
    expect(steps.at(-1)!.state.nodes).toEqual([
      { name: 'C', next: 2 },
      { name: 'B', next: 0 },
      { name: 'A', next: 1 }
    ]);
    expect(steps.at(-1)!.state.a).toBe(2);
  });

  it('refuses a reference to a node outside the pool, a place in the pool, and a second pool', () => {
    expect(() => run(`const n = NodeRef(Node({ name: Name('D'), next: End('end') }));`)).toThrow(
      'A NodeRef refers to a Node in its pool, Nodes: add the Node to the pool first, which gives the reference, as nodes.add(Node({ … })).'
    );
    expect(() => run(`const n = nodes[0];`)).toThrow('A Nodes has no order');
    expect(() => run(`nodes.push(head);`)).toThrow('A pool has no order, so it has no .push()');
    expect(() => run(`const more = Nodes();`)).toThrow('Make the Nodes in the input');
    expect(() => interpretInput(`${list} const again = Nodes();`, domain)).toThrow(
      'There is one Nodes, nodes: a record has one pool.'
    );
  });

  it('refuses a field read through the end, and a write of another type', () => {
    expect(() => run(`let cur = Next(End('end')); const n = cur.next;`)).toThrow(
      'cur is an End ("end"), so it has no next.'
    );
    expect(() => run(`head.next = head.name;`)).toThrow(/head\.next must be a NodeRef or End/);
  });
});
