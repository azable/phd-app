import { describe, expect, it } from 'vitest';

import { headTrim } from './heads';
import { curvePath, labelPoint, reachDrawn, routeCurve, wirePath, type Box } from './route';
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

describe('where a label goes', () => {
  const label = { width: 20, height: 10 };
  const line = 'M0,0 L100,0';
  const box = (left: number, top: number, right: number, bottom: number): Box => ({
    left,
    top,
    right,
    bottom
  });

  it('sits on its middle where that is clear', () => {
    expect(labelPoint(line, point(50, 0), label, [box(-30, -10, 0, 10)])).toEqual(point(50, 0));
  });

  it('moves along its link, nearest the middle, clear of what it would overlap', () => {
    const placed = labelPoint(line, point(50, 0), label, [box(40, -10, 60, 10)]);
    expect(placed.y).toBe(0);
    expect(Math.abs(placed.x - 50)).toBeGreaterThanOrEqual(22);
    expect(Math.abs(placed.x - 50)).toBeLessThan(30);
  });

  it('moves beside its link where nowhere along it is clear', () => {
    const placed = labelPoint(line, point(50, 0), label, [box(-10, 0, 110, 0)]);
    expect(Math.abs(placed.y)).toBeGreaterThanOrEqual(5);
    expect(placed.x).toBe(50);
  });
});

describe('an arrow reaching what its node draws', () => {
  // A vertex's name cell and the caption under it, in a node keeping room below for a label shown
  // only at some steps; the arrow was routed from the bottom of that room.
  const name: Box = { left: 20, top: 0, right: 70, bottom: 50 };
  const caption: Box = { left: 10, top: 50, right: 80, bottom: 74 };
  const label: Box = { left: 15, top: 90, right: 75, bottom: 114 };
  const down = 'M45,180 C45,220 45,260 45,300';
  const none = { start: 0, end: 0 };

  it('carries an end towards the middle of what is drawn there, to the nearest box', () => {
    expect(reachDrawn(down, { start: [name, caption], end: [] }, none)).toMatchObject({
      path: 'M45,74 C45,149.3 45,224.7 45,300',
      start: point(45, 74),
      end: point(45, 300)
    });
    expect(reachDrawn(down, { start: [name, caption, label], end: [] }, none)?.start).toEqual(
      point(45, 114)
    );
    // A slanting arrow comes in along the line to the name's middle.
    const slant = reachDrawn(
      'M60,180 C70,220 80,260 90,300',
      { start: [name, caption], end: [] },
      none
    );
    expect(slant?.start.y).toBeCloseTo(74, 5);
    expect(slant?.start.x).toBeCloseTo(60 - (15 * (180 - 74)) / (180 - 25), 5);
  });

  it('meets the element past the empty corner of a caption wider than it', () => {
    // Coming in aslant from below left, it ends in the caption's box beside the name: the line to
    // the name's middle crosses only the caption's top corner, above its text.
    const aslant = reachDrawn(
      'M-100,120 C-60,110 -20,90 12,52',
      { start: [], end: [name, caption] },
      none
    );
    expect(aslant?.end.x).toBeCloseTo(20, 5);
    expect(aslant?.end.y).toBeLessThan(50);
    // From straight below, through the caption's text, it still stops under the caption.
    expect(
      reachDrawn('M45,300 C45,260 45,220 45,90', { start: [], end: [name, caption] }, none)?.end
    ).toEqual(point(45, 74));
  });

  it('reaches what is drawn from a curve leaving sideways, keeping its bend', () => {
    // Leaving to the right, as an arc between vertices side by side: carried on the way it
    // leaves, it would never meet the vertex.
    const bowed = reachDrawn(
      'M100,180 C160,180 200,250 200,300',
      { start: [name, caption], end: [] },
      none
    );
    expect(bowed?.start.y).toBeCloseTo(74, 5);
    expect(bowed?.start.x).toBeCloseTo(100 - (55 * (180 - 74)) / (180 - 25), 5);
    // The first control point keeps its offset from a third of the way along the line between
    // the ends, so the curve still leaves bending the same way.
    const [, k1x, k1y] = /C(-?[\d.]+),(-?[\d.]+)/u.exec(bowed?.path ?? '') ?? [];
    const third = { x: (bowed!.start.x * 2 + 200) / 3, y: (74 * 2 + 300) / 3 };
    expect(Number(k1x) - third.x).toBeCloseTo(160 - (100 * 2 + 200) / 3, 0);
    expect(Number(k1y) - third.y).toBeCloseTo(180 - (180 * 2 + 300) / 3, 0);
  });

  it('carries both ends, stopping short for a head, and moves the middle with them', () => {
    const up = 'M45,300 C45,260 45,220 45,180';
    expect(reachDrawn(up, { start: [], end: [name, caption] }, { start: 0, end: 9 })?.end).toEqual(
      point(45, 83)
    );
    const below: Box = { left: 20, top: 400, right: 70, bottom: 450 };
    const both = reachDrawn(down, { start: [name, caption], end: [below] }, none);
    expect([both?.start, both?.end]).toEqual([point(45, 74), point(45, 400)]);
    expect(both?.drift.x).toBeCloseTo(0, 5);
    expect(both?.drift.y).toBeCloseTo((74 + 400) / 2 - 240, 5);
  });

  it('is left as it is where both ends meet a box, or it is no curve', () => {
    const drawn = { start: [name, caption], end: [] };
    expect(reachDrawn('M45,50 C45,100 45,200 45,300', drawn, none)).toBeUndefined();
    expect(reachDrawn('M45,83 C45,100 45,200 45,300', drawn, { start: 9, end: 0 })).toBeUndefined();
    expect(reachDrawn(down, { start: [], end: [] }, none)).toBeUndefined();
    expect(reachDrawn('M45,180 L45,300', drawn, none)).toBeUndefined();
  });
});

describe('straight links', () => {
  it('join boxes side by side level, in the span they share, as a next field to the node beside', () => {
    // Project 1323b715: a node's next field, low in its node, to the next node, taller: aimed
    // centre to centre, each arrow ran up a slope.
    const field: Box = { left: 0, top: 115, right: 50, bottom: 165 };
    const node: Box = { left: 150, top: 50, right: 260, bottom: 190 };
    const [start, , , end] = routeCurve(field, node, [], [0]).curve;
    expect(start).toEqual(point(50, 140));
    expect(end).toEqual(point(150, 140));
    // One above the other, plumb.
    const below: Box = { left: 160, top: 300, right: 200, bottom: 330 };
    const down = routeCurve(node, below, [], [0]).curve;
    expect(down[0].x).toBe(down[3].x);
    // Apart both ways, centre to centre as before.
    const corner: Box = { left: 400, top: 400, right: 420, bottom: 420 };
    const slope = routeCurve(field, corner, [], [0]).curve;
    expect(slope[0].y).not.toBe(slope[3].y);
  });
});
