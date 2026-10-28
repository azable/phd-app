import { describe, expect, it } from 'vitest';

import { settleSpans, solveSpan, type SpanInput, type SpanLayout } from './span';

const input = (
  boxes: { key: string; width: number; height: number }[],
  links: string[] = []
): SpanInput => ({
  seed: 9,
  boxes,
  anchors: {},
  parts: [],
  options: { template: 'free', links, gap: 8, aspect: 2 }
});

describe('layouts over a whole animation', () => {
  const steps = [
    input([
      { key: 'a', width: 40, height: 40 },
      { key: 'b', width: 40, height: 40 }
    ]),
    input(
      [
        { key: 'a', width: 60, height: 40 },
        { key: 'b', width: 40, height: 40 },
        { key: 'c', width: 40, height: 40 }
      ],
      ['a -> c']
    )
  ];

  it('places every child that ever appears, at its largest size, clear of the others', () => {
    const span = solveSpan(steps);
    expect(Object.keys(span.positions).sort()).toEqual(['a', 'b', 'c']);
    const sizes = { a: 60, b: 40, c: 40 } as const;
    const keys = ['a', 'b', 'c'] as const;
    for (const [i, first] of keys.entries())
      for (const second of keys.slice(i + 1)) {
        const [p, q] = [span.positions[first], span.positions[second]];
        expect(
          p.x + sizes[first] <= q.x + 0.5 ||
            q.x + sizes[second] <= p.x + 0.5 ||
            p.y + 40 <= q.y + 0.5 ||
            q.y + 40 <= p.y + 0.5
        ).toBe(true);
      }
    // The link that appears at the second step is routed once, for every step it is drawn in.
    expect(span.edges.map(({ link }) => link)).toEqual(['a -> c']);
  });

  it('gives the same solution whatever order the steps were recorded in', () => {
    const forward = new Map([
      [0, steps[0]],
      [1, steps[1]]
    ]);
    const backward = new Map([
      [1, steps[1]],
      [0, steps[0]]
    ]);
    const scopes = new Map<string, { inputs: Map<number, SpanInput>; span?: SpanLayout }>([
      ['x', { inputs: forward }],
      ['y', { inputs: backward }]
    ]);
    expect(settleSpans(scopes)).toBe(true);
    expect(scopes.get('x')?.span?.positions).toEqual(scopes.get('y')?.span?.positions);
    // Solving again from the same records changes nothing, so recording can stop.
    expect(settleSpans(scopes)).toBe(false);
  });
});

describe('structure over a whole animation', () => {
  const boxes = ['a', 'b', 'c', 'd'].map((key) => ({ key, width: 40, height: 40 }));
  const step = (links: { from: string; to: string; id: string }[], seed: number): SpanInput => ({
    seed,
    boxes,
    anchors: {},
    parts: [],
    options: {
      template: 'free',
      links: links.map((link) => ({ ...link, directed: true })),
      gap: 8,
      aspect: 2
    }
  });
  const path = [
    { from: 'a', to: 'b', id: '1:1' },
    { from: 'b', to: 'c', id: '2:1' },
    { from: 'c', to: 'd', id: '3:1' }
  ];

  it('reads the structure from links present at every step, drawing the rest on top', () => {
    const steps = [step(path, 3), step([...path, { from: 'b', to: 'd', id: '4:1' }], 3)];
    // The link that comes and goes would make a layered graph; only the path counts, so a layered
    // form does not apply, and one that suits the path is drawn instead.
    for (const input of steps) input.options.form = 'layers-down';
    const span = solveSpan(steps);
    expect(span.choices.form).not.toBe('layers-down');
    expect(span.problems).toEqual([]);
    expect(span.edges.map(({ id }) => id)).toEqual(['1:1', '2:1', '3:1', '4:1']);
  });

  it('keeps a link that joins a child as it appears, as a tree grows', () => {
    // Each step adds a child and its link: the links are absent only where their ends are.
    const tree = [
      { from: 'a', to: 'b', id: '5:1' },
      { from: 'a', to: 'c', id: '6:1' },
      { from: 'b', to: 'd', id: '7:1' }
    ];
    const grown = (count: number) => ({
      seed: 3,
      boxes: boxes.slice(0, count),
      anchors: {},
      parts: [],
      options: {
        template: 'free' as const,
        links: tree.slice(0, count - 1).map((link) => ({ ...link, directed: true })),
        gap: 8,
        aspect: 2,
        form: 'tree-down' as const
      }
    });
    const span = solveSpan([grown(1), grown(2), grown(3), grown(4)]);
    // Every link is structure, so the tree form the view asks for takes it.
    expect(span.problems).toEqual([]);
    expect(span.choices.form).toBe('tree-down');
  });
});
