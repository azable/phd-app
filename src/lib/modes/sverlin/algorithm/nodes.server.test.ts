import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain, interpretInput } from './interpret.server';

const domain = interpretDomain(`
  const Name = type(['A', 'B', 'C', 'D']);
  const Flag = type('boolean');
  const End = type(['end']);
  const Node = record({ name: Name, next: Next });
  const NodeRef = ref(Node);
  const Next = union(NodeRef, End);
  const IsNode = unop((p: Next) => Flag(p !== 'end'));
  const NewNode = binop((v: Name, n: Next) => Node({ name: v, next: n }));
`);

const list = `const head = NodeRef(Node({ name: 'A', next:
  NodeRef(Node({ name: 'B', next: NodeRef(Node({ name: 'C', next: End('end') })) })) }));`;

const run = (algorithm: string, input = list) =>
  interpretAlgorithm(algorithm, interpretInput(input, domain), domain);

describe('nodes and references', () => {
  it('records a node in its heap, in the order made, and a reference as its place there', () => {
    const input = interpretInput(list, domain);
    // The innermost node is made first.
    expect(input.state['ȟNode']).toEqual([
      { name: 'C', next: 'end' },
      { name: 'B', next: 0 },
      { name: 'A', next: 1 }
    ]);
    expect(input.state.head).toBe(2);
    expect(input.types.head).toBe('NodeRef');
    expect(input.targets?.head).toBe('ȟNode');
    expect(input.types['ȟNode[1].next']).toBe('NodeRef');
    expect(input.types['ȟNode[0].next']).toBe('End');
  });

  it('reverses a list through its references', () => {
    const steps = run(`
      let prev = Next(End('end'));
      let cur = Next(head);
      while (IsNode(cur)) @rewire{
        const after = cur.next;
        cur.next = prev;
        prev = cur;
        cur = after;
      }
    `);
    const last = steps.at(-1)!;
    expect(last.state['ȟNode']).toEqual([
      { name: 'C', next: 1 },
      { name: 'B', next: 2 },
      { name: 'A', next: 'end' }
    ]);
    expect(last.state.prev).toBe(0);
    expect(last.state.cur).toBe('end');
    // The nodes keep their identities as their links change.
    const ids = (step: (typeof steps)[number]) =>
      [0, 1, 2].map((index) => step.identities?.ids[`ȟNode[${index}]`]);
    expect(ids(last)).toEqual(ids(steps[0]));
  });

  it('pushes made nodes in front, and lets go of nodes nothing refers to', () => {
    const steps = run(
      `
      let first = Next(End('end'));
      @push[first = NodeRef(NewNode(Name('D'), first));
      first = NodeRef(NewNode(Name('C'), first));]
      @drop[first = first.next;]
    `,
      ''
    );
    expect(steps.at(-2)!.state['ȟNode']).toEqual([
      { name: 'D', next: 'end' },
      { name: 'C', next: 0 }
    ]);
    expect(steps.at(-1)!.state['ȟNode']).toEqual([{ name: 'D', next: 'end' }]);
  });

  it('keeps a node live inside a call while only its caller holds it', () => {
    // Inside visit, lone is out of scope, held only by build, which called it.
    const steps = run(
      `
      function visit(n) @visit{
        if (IsNode(n.next)) visit(n.next);
      }
      function build() @build{
        const lone = NodeRef(NewNode(Name('D'), End('end')));
        const b = NodeRef(NewNode(Name('B'), NodeRef(NewNode(Name('C'), End('end')))));
        visit(b);
      }
      @go[build();]
    `,
      ''
    );
    const names = (step: (typeof steps)[number]) =>
      ((step.state['ȟNode'] ?? []) as { name: string }[]).map(({ name }) => name).sort();
    const inVisit = steps.filter((step) => 'n' in step.state);
    expect(inVisit.length).toBeGreaterThan(1);
    for (const step of inVisit) expect(names(step)).toEqual(['B', 'C', 'D']);
  });

  it('keeps a circular list finite, and takes an input with a variable for each node', () => {
    const steps = run(
      `@close[c.next = a;]`,
      `const c = NodeRef(Node({ name: 'C', next: End('end') }));
      const b = NodeRef(Node({ name: 'B', next: c }));
      const a = NodeRef(Node({ name: 'A', next: b }));`
    );
    expect(steps.at(-1)!.state['ȟNode']).toEqual([
      { name: 'C', next: 2 },
      { name: 'B', next: 0 },
      { name: 'A', next: 1 }
    ]);
    expect(steps.at(-1)!.state.a).toBe(2);
  });

  it('refuses a field read through the end, and a write of another type', () => {
    expect(() => run(`let cur = Next(End('end')); const n = cur.next;`)).toThrow(
      'cur is an End ("end"), so it has no next.'
    );
    expect(() => run(`head.next = head.name;`)).toThrow(/head\.next must be a NodeRef or End/);
  });
});
