import { describe, expect, it } from 'vitest';

import { sequenceForms } from './forms';
import {
  arrange,
  keyedRandom,
  layoutSeedFor,
  type ArrangeBox,
  type ArrangeOptions,
  type ArrangeResult
} from './arrange';

const boxes: ArrangeBox[] = [
  { key: 'a', width: 40, height: 40 },
  { key: 'b', width: 40, height: 40 },
  { key: 'c', width: 40, height: 40 },
  { key: 'head', width: 36, height: 20 },
  { key: 'note', width: 150, height: 32 }
];
const options: ArrangeOptions = {
  template: 'free',
  links: ['a -> b', 'b -> c', 'head -> a'],
  constraints: ['head above a', 'note below b', 'c rightOf b'],
  flow: 'x',
  gap: 12
};

function rect(result: ArrangeResult, key: string) {
  const index = boxes.findIndex((box) => box.key === key);
  const { x, y } = result.placements[index];
  const { width, height } = boxes[index];
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    cx: x + width / 2,
    cy: y + height / 2
  };
}

describe('constraint arrangement', () => {
  const result = arrange(boxes, { ...options, random: keyedRandom(1, 'diagram') });

  it('places related nodes directly above, below, or beside each other, a gap apart', () => {
    const [a, b, c, head, note] = ['a', 'b', 'c', 'head', 'note'].map((key) => rect(result, key));
    expect(head.bottom + 12).toBeLessThanOrEqual(a.top + 0.5);
    expect(Math.abs(head.cx - a.cx)).toBeLessThan(0.5);
    expect(note.top).toBeGreaterThanOrEqual(b.bottom + 12 - 0.5);
    expect(Math.abs(note.cx - b.cx)).toBeLessThan(0.5);
    expect(c.left).toBeGreaterThanOrEqual(b.right + 12 - 0.5);
    expect(Math.abs(c.cy - b.cy)).toBeLessThan(0.5);
    expect(result.problems).toEqual([]);
  });

  it('keeps every node clear of the others and measures the whole', () => {
    const rects = boxes.map(({ key }) => rect(result, key));
    for (const [i, first] of rects.entries())
      for (const second of rects.slice(i + 1))
        expect(
          first.right <= second.left + 0.5 ||
            second.right <= first.left + 0.5 ||
            first.bottom <= second.top + 0.5 ||
            second.bottom <= first.top + 0.5
        ).toBe(true);
    expect(Math.min(...rects.map(({ left }) => left))).toBeCloseTo(0);
    expect(Math.min(...rects.map(({ top }) => top))).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(Math.max(...rects.map(({ right }) => right)));
    expect(result.edges).toHaveLength(3);
    expect(result.edges.every(({ directed }) => directed)).toBe(true);
  });

  it('repeats a layout for a seed, and a form drawn from it varies between seeds', () => {
    const again = arrange(boxes, { ...options, random: keyedRandom(1, 'diagram') });
    expect(again.placements).toEqual(result.placements);
    const scattered = (seed: number) =>
      arrange(boxes, { ...options, form: 'scatter', random: keyedRandom(seed, 'diagram') })
        .placements;
    const first = JSON.stringify(scattered(1));
    expect([2, 3, 4].some((seed) => JSON.stringify(scattered(seed)) !== first)).toBe(true);
  });

  it('reports links and relations it cannot use, and lays out the rest', () => {
    const partial = arrange(boxes, {
      template: 'free',
      links: ['a -> missing', 'a => b'],
      constraints: ['a near b', 'a below'],
      gap: 12
    });
    expect(partial.problems).toEqual([
      '"a -> missing" names no node with key "missing".',
      '"a => b" is not a link such as "a -> b".',
      '"a near b" is not a relation such as "a below b" (above, below, leftOf, rightOf, sameRow, sameColumn).',
      '"a below" is not a relation such as "a below b" (above, below, leftOf, rightOf, sameRow, sameColumn).'
    ]);
    expect(partial.placements).toHaveLength(boxes.length);
  });
});

describe('arrangement templates', () => {
  const overlaps = (result: ArrangeResult) =>
    boxes.some((first, i) =>
      boxes.slice(i + 1).some((second, offset) => {
        const [a, b] = [rect(result, first.key), rect(result, second.key)];
        void offset;
        return (
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5
        );
      })
    );

  it('lays a row out in order a gap apart, lined up across it', () => {
    const row = [
      { key: 'a', width: 40, height: 40 },
      { key: 'b', width: 30, height: 20 },
      { key: 'c', width: 50, height: 30 }
    ];
    const tops = (align: 'start' | 'end') => {
      const { placements } = arrange(row, { template: 'row', align, gap: 10 });
      expect(placements[1].x - placements[0].x).toBeCloseTo(50, 0);
      expect(placements[2].x - placements[1].x).toBeCloseTo(40, 0);
      return placements.map(({ y }, i) => (align === 'start' ? y : y + row[i].height));
    };
    for (const align of ['start', 'end'] as const) {
      const edges = tops(align);
      expect(edges.every((edge) => Math.abs(edge - edges[0]) < 0.5)).toBe(true);
    }
  });

  it('gathers unlinked children compactly in a free arrangement, varying with the seed', () => {
    const free = (seed: number) =>
      arrange(boxes, { template: 'free', gap: 10, random: keyedRandom(seed, 'frame') });
    const first = free(1);
    expect(overlaps(first)).toBe(false);
    // Together the boxes cover about 9000 square pixels; a compact arrangement stays near that.
    expect(first.width * first.height).toBeLessThan(60_000);
    const layouts = [1, 2, 3, 4, 5].map((seed) => JSON.stringify(free(seed).placements));
    expect(new Set(layouts).size).toBeGreaterThan(1);
  });
});

describe('links along a flow', () => {
  // Columns of a value cell with a label below one of them, as a list with a "current" label.
  const columns: ArrangeBox[] = [
    { key: 'n0', width: 40, height: 40 },
    { key: 'n1', width: 50, height: 62 },
    { key: 'n2', width: 40, height: 40 }
  ];
  const anchors = {
    n0: { box: 0, x: 0, y: 0, width: 40, height: 40 },
    n1: { box: 1, x: 5, y: 0, width: 40, height: 40 },
    n2: { box: 2, x: 0, y: 0, width: 40, height: 40 }
  };
  // A line, with arrows preferring to run straight (the seed's curve style below one half).
  const chain = arrange(columns, {
    template: 'free',
    links: ['n0 -> n1', 'n1 -> n2'],
    flow: 'x',
    form: 'line',
    gap: 6,
    anchors,
    random: () => 0.25
  });

  it('runs a chain straight on its anchors, with visible arrows between them', () => {
    const centre = (key: 'n0' | 'n1' | 'n2', index: number) => ({
      x: chain.placements[index].x + anchors[key].x + 20,
      y: chain.placements[index].y + anchors[key].y + 20
    });
    const [a, b, c] = [centre('n0', 0), centre('n1', 1), centre('n2', 2)];
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    expect(Math.abs(b.y - c.y)).toBeLessThan(0.5);
    // Anchors sit at least an arrow's room apart, edge to edge.
    expect(b.x - a.x - 40).toBeGreaterThanOrEqual(28 - 0.5);
    expect(c.x - b.x - 40).toBeGreaterThanOrEqual(28 - 0.5);
    // Arrows leave and meet the anchors' edges, not the taller column's.
    const [first] = chain.edges;
    expect(first.x1).toBeCloseTo(a.x + 20, 0);
    expect(first.y1).toBeCloseTo(a.y, 0);
    expect(first.x2).toBeCloseTo(b.x - 20, 0);
    expect(first.y2).toBeCloseTo(b.y, 0);
  });

  it('lays a cycle out as a ring, every node on one circle', () => {
    const ring = arrange(columns, {
      template: 'free',
      links: ['n0 -> n1', 'n1 -> n2', 'n2 -> n0'],
      form: 'ring',
      aspect: 1,
      gap: 6,
      anchors,
      random: keyedRandom(3, 'list')
    });
    expect(ring.edges).toHaveLength(3);
    const centres = ring.placements.map(({ x, y }, i) => ({
      x: x + anchors[columns[i].key as 'n0'].x + 20,
      y: y + anchors[columns[i].key as 'n0'].y + 20
    }));
    const middle = {
      x: centres.reduce((sum, { x }) => sum + x, 0) / 3,
      y: centres.reduce((sum, { y }) => sum + y, 0) / 3
    };
    const radii = centres.map(({ x, y }) => Math.hypot(x - middle.x, y - middle.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1);
  });

  it('draws a chain in each form it names, without overlaps', () => {
    const list = Array.from({ length: 8 }, (_, i) => ({ key: `n${i}`, width: 40, height: 40 }));
    const links = list.slice(1).map(({ key }, i) => `n${i} -> ${key}`);
    const looks = new Set<string>();
    for (const form of sequenceForms) {
      const result = arrange(list, {
        template: 'free',
        links,
        gap: 8,
        aspect: 2,
        form,
        random: keyedRandom(1, 'list')
      });
      expect(result.choices.form).toBe(form);
      looks.add(
        JSON.stringify(result.placements.map(({ x, y }) => [Math.round(x), Math.round(y)]))
      );
      for (const [i, a] of result.placements.entries())
        for (const b of result.placements.slice(i + 1))
          expect(Math.abs(a.x - b.x) >= 40 - 0.5 || Math.abs(a.y - b.y) >= 40 - 0.5).toBe(true);
      for (const edge of result.edges) expect(edge.path).toMatch(/^M[\d.-]+,[\d.-]+ C/u);
    }
    expect(looks.size).toBe(sequenceForms.length);
  });

  it('draws the structure’s natural form, whatever the space, where none fits', () => {
    const list = Array.from({ length: 6 }, (_, i) => ({ key: `n${i}`, width: 40, height: 40 }));
    const chain = list.slice(1).map(({ key }, i) => `n${i} -> ${key}`);
    const tree = ['n0 -> n1', 'n0 -> n2', 'n1 -> n3', 'n1 -> n4', 'n2 -> n5'];
    for (const aspect of [0.5, 1, 3])
      for (const [links, flow, natural] of [
        [chain, undefined, 'line'],
        [tree, undefined, 'tree-down'],
        [tree, 'x', 'tree-right']
      ] as const) {
        const random = keyedRandom(aspect, 'list');
        const unnamed = arrange(list, { template: 'free', links, gap: 8, aspect, flow, random });
        const unfit = arrange(list, {
          ...{ template: 'free', links, gap: 8, aspect, flow, random },
          form: 'ring'
        });
        expect([unnamed.choices.form, unfit.choices.form]).toEqual([natural, natural]);
      }
  });
});

describe('layout choices', () => {
  const list = Array.from({ length: 6 }, (_, i) => ({ key: `n${i}`, width: 40, height: 40 }));
  const links = list.slice(1).map(({ key }, i) => `n${i} -> ${key}`);

  it('reports what the seed chose, and reproduces it from the same layout seed', () => {
    const seed = layoutSeedFor(5, '50:1');
    const first = arrange(list, {
      template: 'free',
      links,
      gap: 8,
      random: keyedRandom(seed, 'layout')
    });
    const again = arrange(list, {
      template: 'free',
      links,
      gap: 8,
      random: keyedRandom(seed, 'layout')
    });
    expect(first.choices.form).toBeDefined();
    // Each link draws its own curve, so the arrangement reports a curve style only when pinned.
    expect(first.choices.curve).toBeUndefined();
    expect(again.placements).toEqual(first.placements);
    expect(again.choices).toEqual(first.choices);
    // Different places in a view derive different seeds.
    expect(layoutSeedFor(5, '50:1')).not.toBe(layoutSeedFor(5, '60:1'));
  });

  it('keeps a pinned form and curve style', () => {
    for (const seed of [1, 2, 3]) {
      const result = arrange(list, {
        template: 'free',
        links,
        gap: 8,
        form: 'wave',
        curve: 'straight',
        random: keyedRandom(seed, 'layout')
      });
      expect(result.choices).toEqual({ form: 'wave', curve: 'straight' });
    }
  });
});

describe('link components', () => {
  it('draws each link spec as an edge carrying its id, with its own curve style', () => {
    const boxes = [
      { key: 'a', width: 40, height: 40 },
      { key: 'b', width: 40, height: 40 },
      { key: 'c', width: 40, height: 40 }
    ];
    const result = arrange(boxes, {
      template: 'free',
      gap: 8,
      curve: 'straight',
      links: ['a -> b', { from: 'b', to: 'c', directed: false, id: '12:3', curve: 'curved' }],
      random: keyedRandom(2, 'layout')
    });
    expect(result.edges.map(({ link, id, directed }) => ({ link, id, directed }))).toEqual([
      { link: 'a -> b', id: undefined, directed: true },
      { link: 'b - c', id: '12:3', directed: false }
    ]);
    // The written link runs straight, as the arrangement asks; the component curves, as it asks.
    const numbers = result.edges.map(({ path }) =>
      path
        .split(/[ ,MC]+/u)
        .filter(Boolean)
        .map(Number)
    );
    const offLine = ([x1, y1, cx1, cy1, , , x2, y2]: number[]) =>
      Math.abs((x2 - x1) * (cy1 - y1) - (y2 - y1) * (cx1 - x1)) / Math.hypot(x2 - x1, y2 - y1);
    expect(offLine(numbers[0])).toBeLessThan(1);
    expect(offLine(numbers[1])).toBeGreaterThan(1);
  });
});

describe('link bends', () => {
  const boxes = [
    { key: 'a', width: 40, height: 40 },
    { key: 'b', width: 40, height: 40 }
  ];

  it('draws a pinned bend exactly, and reports the bend each link drew', () => {
    for (const seed of [1, 2, 3]) {
      const result = arrange(boxes, {
        template: 'free',
        gap: 8,
        links: [
          { from: 'a', to: 'b', directed: true, id: '3:1', bend: -0.3 },
          { from: 'b', to: 'a', directed: true, id: '4:1' }
        ],
        random: keyedRandom(seed, 'layout')
      });
      expect(result.edges[0].bend).toBe(-0.3);
      const again = arrange(boxes, {
        template: 'free',
        gap: 8,
        links: [
          { from: 'a', to: 'b', directed: true, id: '3:1', bend: -0.3 },
          { from: 'b', to: 'a', directed: true, id: '4:1', bend: result.edges[1].bend }
        ],
        random: keyedRandom(seed + 10, 'layout')
      });
      // Pinning the reported bend keeps the curve's shape relative to its ends.
      expect(again.edges[1].bend).toBe(result.edges[1].bend);
    }
  });
});

describe('forms along a flow', () => {
  const tree = ['r', 'a', 'b', 'c', 'd'].map((key) => ({ key, width: 40, height: 30 }));
  const links = ['r -> a', 'r -> b', 'a -> c', 'a -> d'];

  it('draws only forms whose links run the way the flow points', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const across = arrange(tree, {
        template: 'free',
        links,
        gap: 8,
        flow: 'x',
        random: keyedRandom(seed, 'layout')
      });
      const down = arrange(tree, {
        template: 'free',
        links,
        gap: 8,
        flow: 'y',
        random: keyedRandom(seed, 'layout')
      });
      expect(['tree-down', 'radial', 'indented']).not.toContain(across.choices.form);
      expect(['tree-right', 'radial']).not.toContain(down.choices.form);
    }
  });
});

describe('a tree drawn from its fields', () => {
  // Each node is [ left | value | right ]; a link starts at the field it leaves.
  const nodes = ['r', 'a', 'b'].map((key) => ({ key, width: 90, height: 30 }));
  const field = (box: number, side: 'left' | 'right') => ({
    box,
    x: side === 'left' ? 0 : 60,
    y: 0,
    width: 30,
    height: 30
  });

  it('places the child its left field leads to left of its right field’s, whatever the link order', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = arrange(nodes, {
        template: 'free',
        // Written right first, so only where each starts says which child is left.
        links: [
          { from: 'r.right', to: 'b', directed: true },
          { from: 'r.left', to: 'a', directed: true }
        ],
        anchors: { 'r.left': field(0, 'left'), 'r.right': field(0, 'right') },
        form: 'tree-down',
        flow: 'y',
        gap: 8,
        random: keyedRandom(seed, 'layout')
      });
      expect(result.placements[1].x).toBeLessThan(result.placements[2].x);
    }
  });
});
