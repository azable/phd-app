import { describe, expect, it } from 'vitest';

import type { SceneLink, SceneNode, SceneStep } from './scene';
import {
  drawnScene,
  headTransform,
  linkPath,
  mixPath,
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
});
