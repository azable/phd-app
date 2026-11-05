import { describe, expect, it } from 'vitest';

import type { SceneLink, SceneNode, SceneStep } from './scene';
import {
  drawnScene,
  headTransform,
  linkPath,
  mixColour,
  mixPath,
  pairNodes,
  sceneBetween,
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
