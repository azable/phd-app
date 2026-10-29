import { describe, expect, it } from 'vitest';

import { headTrim } from './heads';
import { curvePath, wirePath, type Box } from './route';
import { routeWires } from './wires';

const point = (x: number, y: number) => ({ x, y });

describe('paths stopped short for heads', () => {
  it('stop a curve short of each end by its head’s length, keeping its shape', () => {
    const straight = [point(0, 0), point(30, 0), point(60, 0), point(90, 0)] as const;
    const drawn = curvePath(straight, { start: 0, end: 9 });
    expect(drawn.start).toEqual(point(0, 0));
    expect(drawn.end.x).toBeCloseTo(81, 0);
    expect(drawn.end.y).toBeCloseTo(0, 5);
    const both = curvePath(straight, { start: 12, end: 12 });
    expect(both.start.x).toBeCloseTo(12, 0);
    expect(both.end.x).toBeCloseTo(78, 0);
    // A bowed curve keeps to the same curve, its new end on the old one.
    const bowed = [point(0, 0), point(30, 40), point(60, 40), point(90, 0)] as const;
    const short = curvePath(bowed, { start: 0, end: 16 });
    expect(Math.hypot(short.end.x - 90, short.end.y)).toBeGreaterThan(12);
    expect(Math.hypot(short.end.x - 90, short.end.y)).toBeLessThan(17);
  });

  it('never let heads swallow a short link whole', () => {
    const tiny = [point(0, 0), point(4, 0), point(8, 0), point(12, 0)] as const;
    const drawn = curvePath(tiny, { start: 16, end: 16 });
    expect(drawn.end.x - drawn.start.x).toBeGreaterThan(2);
  });

  it('stop a wire short along its first and last runs, its label on its longest run', () => {
    const wire = wirePath([point(0, 0), point(50, 0), point(50, 100), point(60, 100)], {
      start: 0,
      end: 9
    });
    expect(wire.path).toBe('M0,0 L50,0 L50,100 L51,100');
    expect(wire.middle).toEqual(point(50, 50));
  });

  it('stop the line at the back of a head it would show through, not at a vee or a bar', () => {
    expect(headTrim('arrow', 9)).toBe(9);
    expect(headTrim('open', 12)).toBe(12);
    expect(headTrim('dot', 6)).toBe(6);
    expect(headTrim('vee', 9)).toBe(0);
    expect(headTrim('bar', 9)).toBe(0);
    expect(headTrim('none', 9)).toBe(0);
  });
});

describe('wires', () => {
  const boxes: Box[] = [
    { left: 0, top: 0, right: 40, bottom: 30 },
    { left: 120, top: 0, right: 160, bottom: 30 },
    { left: 0, top: 100, right: 40, bottom: 130 },
    { left: 120, top: 100, right: 160, bottom: 130 },
    { left: 60, top: 50, right: 100, bottom: 80 }
  ];
  const inside = ({ x, y }: { x: number; y: number }, box: Box) =>
    x > box.left + 0.5 && x < box.right - 0.5 && y > box.top + 0.5 && y < box.bottom - 0.5;
  const onEdge = ({ x, y }: { x: number; y: number }, box: Box) =>
    x >= box.left - 0.5 &&
    x <= box.right + 0.5 &&
    y >= box.top - 0.5 &&
    y <= box.bottom + 0.5 &&
    !inside({ x, y }, box);

  it('run straight and turn at right angles, from edge to edge, round the boxes between', () => {
    const links = [
      { from: 0, to: 3 },
      { from: 1, to: 2 },
      { from: 0, to: 1 },
      { from: 4, to: 3 }
    ];
    const wires = routeWires(
      boxes.map((box) => ({ box })),
      links.map(({ from, to }) => ({ from: { child: from }, to: { child: to } }))
    );
    expect(wires).toHaveLength(4);
    wires.forEach((corners, i) => {
      for (let k = 1; k < corners.length; k++) {
        const [a, b] = [corners[k - 1], corners[k]];
        expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.5);
      }
      expect(onEdge(corners[0], boxes[links[i].from])).toBe(true);
      expect(onEdge(corners.at(-1)!, boxes[links[i].to])).toBe(true);
      // Sampled along each run, a wire crosses no box.
      for (let k = 1; k < corners.length; k++)
        for (let t = 0.1; t < 1; t += 0.1) {
          const at = {
            x: corners[k - 1].x + (corners[k].x - corners[k - 1].x) * t,
            y: corners[k - 1].y + (corners[k].y - corners[k - 1].y) * t
          };
          expect(boxes.some((box) => inside(at, box))).toBe(false);
        }
    });
  });

  it('route boxes of a free layout, whose rows and columns do not line up', () => {
    // Scattered boxes of different sizes, overlapping across: no grid's lines meet them all.
    const scattered: Box[] = [
      { left: 0, top: 0, right: 60, bottom: 30 },
      { left: 40, top: 70, right: 70, bottom: 90 },
      { left: 110, top: 20, right: 190, bottom: 50 },
      { left: 150, top: 100, right: 170, bottom: 140 },
      { left: 10, top: 150, right: 90, bottom: 170 }
    ];
    const links = [
      [0, 3],
      [1, 2],
      [4, 2],
      [3, 0],
      [1, 4]
    ].map(([from, to]) => ({ from: { child: from }, to: { child: to } }));
    const wires = routeWires(
      scattered.map((box) => ({ box })),
      links
    );
    wires.forEach((corners, i) => {
      expect(onEdge(corners[0], scattered[links[i].from.child])).toBe(true);
      expect(onEdge(corners.at(-1)!, scattered[links[i].to.child])).toBe(true);
      for (let k = 1; k < corners.length; k++) {
        const [a, b] = [corners[k - 1], corners[k]];
        expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.5);
      }
    });
  });

  it('meet a box inside a child, running into the child to reach it', () => {
    // A column whose name cell sits at its top, its caption below: the wire meets the cell.
    const column = {
      box: { left: 100, top: 0, right: 160, bottom: 60 },
      ends: [{ left: 110, top: 0, right: 150, bottom: 20 }]
    };
    const [wire] = routeWires(
      [{ box: { left: 0, top: 100, right: 40, bottom: 130 } }, column],
      [{ from: { child: 0 }, to: { child: 1, end: 0 } }]
    );
    expect(onEdge(wire.at(-1)!, column.ends[0])).toBe(true);
  });

  it('keep runs side by side apart', () => {
    const [crossing, back] = routeWires(
      boxes.map((box) => ({ box })),
      [
        { from: { child: 0 }, to: { child: 3 } },
        { from: { child: 1 }, to: { child: 2 } }
      ]
    );
    const vertical = (corners: { x: number; y: number }[]) =>
      corners.slice(1).flatMap((b, k) => (Math.abs(b.x - corners[k].x) < 0.5 ? [b.x] : []));
    for (const x of vertical(crossing))
      for (const other of vertical(back)) expect(Math.abs(x - other)).toBeGreaterThan(1);
  });
});
