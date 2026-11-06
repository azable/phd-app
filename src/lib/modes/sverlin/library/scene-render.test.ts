import { describe, expect, it } from 'vitest';

import type { SceneLink, SceneNode, SceneStep } from './scene';
import {
  drawnScene,
  headTransform,
  linkPath,
  mixColour,
  mixPath,
  ease,
  pairNodes,
  planMove,
  sceneBetween,
  sceneDuring,
  strokeInside
} from './scene-render';

const look = { color: 'black', font: 'Vis Sans', fontSize: 16, fontWeight: 400 };
const node = (id: string, x: number, more: Partial<SceneNode> = {}): SceneNode => ({
  id,
  box: { x, y: 10, width: 40, height: 40 },
  look,
  ...more
});
const link = (from: string, to: string, x: number): SceneLink => ({
  from,
  to,
  directed: true,
  stroke: 'grey',
  strokeWidth: 1.5,
  curve: [
    { x, y: 0 },
    { x: x + 10, y: 0 },
    { x: x + 20, y: 0 },
    { x: x + 30, y: 0 }
  ]
});
const step = (nodes: SceneNode[], links: SceneLink[] = []): SceneStep => ({ nodes, links });

describe('scenes drawn as SVG', () => {
  it('multiplies a nested node’s opacity with its parents’, as the PDF does', () => {
    const drawn = drawnScene(
      step([
        node('a', 0, { look: { ...look, opacity: 0.5 } }),
        node('b', 0, { parent: 'a', look: { ...look, opacity: 0.5 } })
      ])
    );
    expect(drawn.nodes.map(({ opacity }) => opacity)).toEqual([0.5, 0.25]);
  });

  it('writes a curve and a wire as paths, and keys links joining the same nodes apart', () => {
    expect(linkPath(link('a', 'b', 0))).toBe('M0,0 C10,0 20,0 30,0');
    expect(
      linkPath({
        ...link('a', 'b', 0),
        curve: undefined,
        wire: [
          { x: 0, y: 0 },
          { x: 5, y: 5 }
        ]
      })
    ).toBe('M0,0 L5,5');
    const drawn = drawnScene(step([], [link('a', 'b', 0), link('a', 'b', 50)]));
    expect(drawn.links.map(({ key }) => key)).toEqual(['a>b', 'a>b#1']);
  });

  it('draws a stroke inside its box, as a CSS border', () => {
    expect(strokeInside({ x: 0, y: 0, width: 10, height: 10 }, 2)).toEqual({
      x: 1,
      y: 1,
      width: 8,
      height: 8
    });
  });

  it('lays a head’s box along the line from its back to its tip', () => {
    expect(
      headTransform({ shape: 'arrow', size: 10, back: { x: 0, y: 0 }, tip: { x: 0, y: 10 } })
    ).toBe('translate(0 0) rotate(90) scale(1) translate(0 -5)');
  });

  it('mixes two paths written alike, and none written otherwise', () => {
    expect(mixPath('M0,0 L10,0', 'M10,0 L20,0', 0.5)).toBe('M5,0 L15,0');
    expect(mixPath('M0,0 L10,0', 'M0,0 C1,1 2,2 3,3', 0.5)).toBeUndefined();
  });

  it('moves a node both steps draw, fades in a new one and out a gone one, and eases links', () => {
    const from = drawnScene(step([node('a', 0), node('gone', 100)], [link('a', 'b', 0)]));
    const to = drawnScene(step([node('a', 20), node('new', 200)], [link('a', 'b', 20)]));
    const half = sceneBetween(from, to, 0.5);
    const byId = new Map(half.nodes.map((each) => [each.id, each]));
    expect(byId.get('a')?.box.x).toBe(10);
    expect(byId.get('new')?.opacity).toBe(0.5);
    expect(byId.get('gone')?.opacity).toBe(0.5);
    expect(half.links).toHaveLength(1);
    expect(half.links[0].d).toBe('M10,0 C20,0 30,0 40,0');
    expect(sceneBetween(from, to, 1)).toBe(to);
  });

  it('fades a link across where its old and new paths are written otherwise', () => {
    const from = drawnScene(step([], [link('a', 'b', 0)]));
    const to = drawnScene(
      step(
        [],
        [
          {
            ...link('a', 'b', 0),
            curve: undefined,
            wire: [
              { x: 0, y: 0 },
              { x: 9, y: 9 }
            ]
          }
        ]
      )
    );
    const half = sceneBetween(from, to, 0.25);
    expect(half.links.map(({ opacity }) => opacity)).toEqual([0.25, 0.75].reverse());
  });

  it('moves a value by its identity when its node’s id shifts, keeping each in its own card', () => {
    // Three cards each drawing ∞; the first value goes, so the others' render counts shift down.
    const cards = ['a', 'b', 'c'].map((id, i) => node(id, i * 100, { kind: 'Card' }));
    const value = (id: string, card: string, identity: string, x: number) =>
      node(id, x, { parent: card, identity, runs: [] });
    const from = drawnScene(
      step([
        ...cards,
        value('v', 'a', '18', 0),
        value('v#2', 'b', '21', 100),
        value('v#3', 'c', '24', 200)
      ])
    );
    const to = drawnScene(
      step([...cards, value('v', 'b', '21', 100), value('v#2', 'c', '24', 200)])
    );
    const half = sceneBetween(from, to, 0.5);
    const at = (key: string) => half.nodes.find((node) => node.key === key);
    expect([at('v')?.box.x, at('v')?.was]).toEqual([100, 'v#2']);
    expect([at('v#2')?.box.x, at('v#2')?.was]).toEqual([200, 'v#3']);
    expect([at('v~old')?.box.x, at('v~old')?.opacity]).toEqual([0, 0.5]);
  });

  it('eases colours from the old to the new, a fill appearing from transparent', () => {
    expect(mixColour('red', 'red', 0.5)).toBe('red');
    expect(mixColour('red', 'blue', 0.25)).toBe('color-mix(in srgb, blue 25%, red)');
    const from = drawnScene(step([node('a', 0)]));
    const to = drawnScene(step([node('a', 0, { look: { ...look, fill: 'blue' } })]));
    expect(sceneBetween(from, to, 0.5).nodes[0].look.fill).toBe(
      'color-mix(in srgb, blue 50%, transparent)'
    );
  });

  it('pairs a value drawn in several places with the place in the same node first', () => {
    // Every ∞ is one constant: each stays in its card however the cards are ordered.
    const cards = ['a', 'b'].map((id, i) => node(id, i * 100, { kind: 'Card' }));
    const inf = (id: string, card: string, x: number) =>
      node(id, x, { parent: card, identity: 'inf', kind: 'Cost' });
    const from = drawnScene(step([...cards, inf('x', 'a', 0), inf('x#2', 'b', 100)]));
    const to = drawnScene(step([...cards, inf('x', 'b', 100), inf('x#2', 'a', 0)]));
    const pairs = pairNodes(from, to);
    expect([pairs.get('x')?.id, pairs.get('x#2')?.id]).toEqual(['x#2', 'x']);
  });

  it("moves a pointer's arrow and label with it onto an element another pointer is at", () => {
    // hi comes to lo's cell: the cell nests in hi's mark, so hi's arrow is no longer its first node.
    const mark = (id: string, x: number, pointer: string, kind: string) =>
      node(id, x, { identity: `pointer:${pointer}`, kind });
    const part = (id: string, x: number, parent: string, kind: string, identity?: string) =>
      node(id, x, { parent, kind, ...(identity ? { identity } : {}) });
    const lo = (x: number, parent?: string) => ({ ...mark('lo#5', x, '0', 'Lo'), parent });
    const from = drawnScene(
      step([
        lo(100),
        part('cell#6', 100, 'lo#5', 'Lo.Pointed', '6'),
        part('loTip#5', 100, 'lo#5', 'Lo.Tip'),
        mark('hi#7', 300, '1', 'Hi'),
        part('cell#8', 300, 'hi#7', 'Hi.Pointed', '8'),
        part('hiTip#7', 300, 'hi#7', 'Hi.Tip')
      ])
    );
    const to = drawnScene(
      step([
        mark('hi#5', 100, '1', 'Hi'),
        lo(100, 'hi#5'),
        part('cell#6', 100, 'lo#5', 'Hi.Pointed', '6'),
        part('loTip#5', 100, 'lo#5', 'Lo.Tip'),
        part('hiTip#5', 100, 'hi#5', 'Hi.Tip')
      ])
    );
    const pairs = pairNodes(from, to);
    expect(pairs.get('hiTip#5')?.id).toBe('hiTip#7');
    expect(pairs.get('loTip#5')?.id).toBe('loTip#5');
    expect(sceneBetween(from, to, 0.5).nodes.find(({ key }) => key === 'hiTip#5')?.box.x).toBe(200);
  });

  it("draws a moving value over the slots it passes, not under the next slot's fill", () => {
    // Two slots with a fill each; the value in the first moves into the second's place.
    const look2 = { ...look, fill: 'grey' };
    // In the scene's order, as a tree: the first slot, its value, the second slot.
    const scene = (x: number) =>
      drawnScene(
        step([
          node('s1', 0, { look: look2 }),
          node('v', x, { identity: '7', parent: 's1' }),
          node('s2', 100, { look: look2 })
        ])
      );
    const [from, to] = [scene(0), scene(100)];
    const order = sceneBetween(from, to, 0.5).nodes.map(({ key }) => key);
    expect(order.indexOf('v')).toBeGreaterThan(order.indexOf('s2'));
    expect(sceneBetween(from, to, 1).nodes.map(({ key }) => key)).toEqual(['s1', 'v', 's2']);
  });

  it("keeps a nested pointer's arrow its own as the outer pointer leaves the element", () => {
    // i and j at one cell, i's mark inside j's; then j moves left and i stays.
    const mark = (id: string, x: number, pointer: string, parent?: string) =>
      node(id, x, { identity: `pointer:${pointer}`, kind: 'Mark', ...(parent ? { parent } : {}) });
    const tip = (id: string, x: number, parent: string) =>
      node(id, x, { parent, kind: 'Mark.Tip' });
    const from = drawnScene(
      step([
        mark('j#4', 100, '1'),
        mark('i#4', 100, '0', 'j#4'),
        tip('iTip#4', 100, 'i#4'),
        tip('jTip#4', 100, 'j#4')
      ])
    );
    const to = drawnScene(
      step([
        mark('j#3', 0, '1'),
        tip('jTip#3', 0, 'j#3'),
        mark('i#4', 100, '0'),
        tip('iTip#4', 100, 'i#4')
      ])
    );
    const pairs = pairNodes(from, to);
    expect(pairs.get('jTip#3')?.id).toBe('jTip#4');
    expect(pairs.get('iTip#4')?.id).toBe('iTip#4');
  });

  it('starts a copy from its source when the source stays drawn, not from what it overwrites', () => {
    // values[j] = values[j - 1]: 29 stays at j - 1, and 31, its copy, replaces 5 at j.
    const from = drawnScene(
      step([node('a', 0, { identity: '29' }), node('b', 100, { identity: '5' })])
    );
    const to = drawnScene({
      ...step([node('a', 0, { identity: '29' }), node('b', 100, { identity: '31' })]),
      copies: { '31': 29 }
    });
    expect(pairNodes(from, to).get('b')?.identity).toBe('29');
    const half = sceneBetween(from, to, 0.5);
    expect(half.nodes.find(({ key }) => key === 'a')?.box.x).toBe(0);
    expect(half.nodes.find(({ key }) => key === 'b')?.box.x).toBe(50);
  });

  it("moves a copy's parts with it from its source's, not from what it overwrites", () => {
    // Each column holds a bar of no value of its own, as a column view's length does.
    const column = (id: string, x: number, identity: string) => [
      node(id, x, { identity, kind: 'Column' }),
      node(`${id}.bar`, x, { parent: id, kind: 'Column.Bar' })
    ];
    const from = drawnScene(step([...column('a', 0, '29'), ...column('b', 100, '5')]));
    const to = drawnScene({
      ...step([...column('a', 0, '29'), ...column('b', 100, '31')]),
      copies: { '31': 29 }
    });
    expect(pairNodes(from, to).get('b.bar')?.id).toBe('a.bar');
    const half = sceneBetween(from, to, 0.5);
    expect(half.nodes.find(({ key }) => key === 'a.bar')?.box.x).toBe(0);
    expect(half.nodes.find(({ key }) => key === 'b.bar')?.box.x).toBe(50);
  });

  it('starts a copy where its source was, the source keeping its own place', () => {
    // 31 copies 29 at this step; 29 stays where it is.
    const from = drawnScene(step([node('s', 0, { identity: '29' })]));
    const to = drawnScene({
      ...step([node('s', 0, { identity: '29' }), node('c', 200, { identity: '31.seen' })]),
      copies: { '31': 29 }
    });
    expect(drawnScene(step([])).copies).toBeUndefined();
    const half = sceneBetween(drawnScene(step([node('s', 0, { identity: '29.seen' })])), to, 0.5);
    expect(half.nodes.find(({ key }) => key === 'c')?.box.x).toBe(100);
    const stays = sceneBetween(from, to, 0.5);
    expect(stays.nodes.find(({ key }) => key === 's')?.box.x).toBe(0);
    expect(stays.nodes.find(({ key }) => key === 'c')?.opacity).toBe(0.5);
  });
});

describe('moves between steps', () => {
  // values[1] = values[0]: 29 stays at 0, and 31, its copy, replaces 5 at 1.
  const before = drawnScene(
    step([node('a', 0, { identity: '29' }), node('b', 100, { identity: '5' })])
  );
  const after = drawnScene({
    ...step([node('a', 0, { identity: '29' }), node('b', 100, { identity: '31' })]),
    copies: { '31': 29 }
  });
  const xOf = (scene: ReturnType<typeof drawnScene>, key: string) =>
    scene.nodes.find((node) => node.key === key && !node.leaving)?.box.x;

  it('plays the move on from the step before, and a step back as that move reversed', () => {
    expect(planMove(undefined, { step: 0, scene: before })).toBeUndefined();
    expect(planMove({ step: 4, scene: before }, { step: 5, scene: after })).toEqual({
      from: before,
      to: after,
      reversed: false
    });
    expect(planMove({ step: 5, scene: after }, { step: 4, scene: before })).toEqual({
      from: before,
      to: after,
      reversed: true
    });
  });

  it('moves straight to another step, or from a move still playing, without copies', () => {
    const jump = planMove({ step: 1, scene: before }, { step: 5, scene: after });
    expect(jump).toMatchObject({ from: before, reversed: false });
    expect(jump?.to.copies).toBeUndefined();
    const playing = sceneBetween(before, after, 0.3);
    const back = planMove({ step: 5, scene: after }, { step: 4, scene: before }, playing);
    expect(back).toMatchObject({ from: playing, reversed: false });
    expect(back?.to.copies).toBeUndefined();
  });

  it('shows a step back at each moment as the move on was at the same time from its end', () => {
    const on = { from: before, to: after, reversed: false };
    const back = { ...on, reversed: true };
    for (const progress of [0, 0.25, 0.5, 0.8]) {
      const reversed = sceneDuring(back, progress);
      const forward = sceneDuring(on, 1 - progress);
      expect(xOf(reversed, 'b')).toBe(xOf(forward, 'b'));
      expect(reversed.nodes.map(({ opacity }) => opacity)).toEqual(
        forward.nodes.map(({ opacity }) => opacity)
      );
    }
    // The copy slides back from 1 to 0, and the value it overwrote fades back in at 1.
    expect(xOf(sceneDuring(back, 0), 'b')).toBe(100);
    expect(xOf(sceneDuring(back, 0.5), 'b')).toBe(50);
    expect(sceneDuring(back, 0.25).nodes.find(({ leaving }) => leaving)?.opacity).toBe(
      1 - ease(0.75)
    );
    expect(sceneDuring(back, 1)).toBe(before);
  });
});
