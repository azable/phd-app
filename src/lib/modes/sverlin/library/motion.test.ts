import { describe, expect, it } from 'vitest';

import { linkChanges, pairByRole, routeAt } from './motion';

describe('pairing the places a value is drawn between steps', () => {
  it('keeps a value drawn again in a caption from pairing with its vertex, wherever the caption comes', () => {
    const vertex = ['VertexCard', 'Graph', 'Main'];
    const caption = ['Status', 'Main'];
    // The caption first in document order: the vertex still pairs with itself, the caption with none.
    expect(pairByRole([caption, vertex], [vertex])).toEqual([undefined, 0]);
    expect(pairByRole([vertex, caption], [vertex])).toEqual([0, undefined]);
  });

  it('pairs places of one role in document order, as cells of a row', () => {
    const cell = ['Row', 'Main'];
    expect(pairByRole([cell, cell], [cell, cell])).toEqual([0, 1]);
  });

  it('still pairs a value that moved to another place, drawn once before and once now', () => {
    expect(pairByRole([['KeyRow', 'Main']], [['Row', 'Main']])).toEqual([0]);
  });
});

describe('links between steps', () => {
  it('follows a link both steps draw along another route, fades in a new one and out a gone one', () => {
    const route = (key: string, d: string) => ({ path: key, key, route: d });
    const changes = linkChanges(
      [route('a-b', 'M0 0L10 10'), route('c-d', 'M5 5L9 9'), route('g-h', 'M0 0L1 1')],
      [route('a-b', 'M0 0L10 10'), route('c-d', 'M5 7L9 9'), route('e-f', 'M1 1L2 2')]
    );
    // Unchanged a-b is left alone: never hidden.
    expect(changes.follow).toEqual([{ path: 'c-d', from: 'M5 5L9 9', to: 'M5 7L9 9' }]);
    expect(changes.appear.map(({ key }) => key)).toEqual(['e-f']);
    expect(changes.gone.map(({ key }) => key)).toEqual(['g-h']);
  });

  it('eases a route written alike number by number, as a caption moving a start down', () => {
    const from = 'M68.3,186.5 C66.9,224.9 81.3,253.4 111.5,272.1';
    const to = 'M73.8,227 C70.5,251.9 83.1,266.9 111.5,272.1';
    expect(routeAt(from, to, 0)).toBe('M68.3,186.5 C66.9,224.9 81.3,253.4 111.5,272.1');
    expect(routeAt(from, to, 1)).toBe('M73.8,227 C70.5,251.9 83.1,266.9 111.5,272.1');
    expect(routeAt(from, to, 0.5)).toBe('M71.05,206.75 C68.7,238.4 82.2,260.15 111.5,272.1');
    // Written differently, as a line becoming a curve: eased by points along each instead.
    expect(routeAt('M0,0 L10,10', 'M0,0 C3,3 6,6 10,10', 0.5)).toBeUndefined();
  });
});
