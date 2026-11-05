/**
 * Scenes drawn on the server (see library/model/scene-of.ts) of one part, with other design
 * values, from a build's layout code alone (see scenesOnServer): only the nodes of the part and what
 * is inside them, drawn with the values asked for, at the steps asked for.
 */

import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import search from './fixtures/search-places.sverlin?raw';
import { scenesOnServer } from './layout.server';
import { colourCss } from './library/node/design';
import { pausingAt, pausingEveryLabel } from './testing/every-pause';

it(
  'draws one kind of node again with other design values, without building again',
  {
    timeout: 120_000
  },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(dijkstra));
    const built = await bundlePresentation(prepared, 1);
    const whole = built.layout.scenes!;
    const cards = whole.steps[3].nodes.filter(({ kind }) => kind === 'VertexCard');
    expect(cards.length).toBeGreaterThan(0);
    const [ownCards, amber] = await scenesOnServer(built.layoutCode, [
      { steps: [3], part: { kind: 'VertexCard' } },
      { steps: [3], part: { kind: 'VertexCard' }, design: { 'VertexCard.fill': 'amber-100' } }
    ]);
    // The part, where the whole step puts it: the cards and the nodes inside them, and no links.
    expect(ownCards!.steps).toHaveLength(1);
    const ids = new Set(cards.map(({ id }) => id));
    const inside = (id: string | undefined): boolean =>
      !!id && (ids.has(id) || inside(whole.steps[3].nodes.find((node) => node.id === id)?.parent));
    expect(ownCards!.steps[0].nodes.length).toBeGreaterThan(cards.length);
    expect(ownCards!.steps[0].nodes.every(({ id }) => inside(id))).toBe(true);
    expect(ownCards!.steps[0].nodes.find(({ id }) => id === cards[0].id)?.box).toEqual(
      cards[0].box
    );
    const filled = amber!.steps[0].nodes.filter(({ kind }) => kind === 'VertexCard');
    expect(filled.map(({ colours }) => colours?.fill)).toEqual(cards.map(() => 'amber-100'));
  }
);

it(
  'names the page, each value, each free layout and each place, as selections and motion need',
  { timeout: 120_000 },
  async () => {
    const graph = await bundlePresentation(prepareSvelteComponent(pausingEveryLabel(dijkstra)), 1);
    const { frame, steps } = graph.layout.scenes!;
    expect(frame.node).toEqual({
      id: expect.any(String),
      label: expect.stringMatching(/^the page/u)
    });
    const nodes = steps.flatMap((step) => step.nodes);
    expect(nodes.some(({ identity }) => identity)).toBe(true);
    // Each run's baseline lies in its box, its ascent below the top.
    const runs = nodes.flatMap(({ runs = [] }) => runs);
    expect(runs.length).toBeGreaterThan(0);
    expect(
      runs.filter(({ box, baseline = NaN }) => !(baseline > box.y && baseline < box.y + box.height))
    ).toEqual([]);
    expect(nodes.find(({ arrangement }) => arrangement)?.arrangement).toEqual(
      expect.objectContaining({ seed: expect.any(Number), form: expect.any(String) })
    );

    const lit = await bundlePresentation(
      prepareSvelteComponent(pausingAt(search, '@probe.low')),
      1,
      {
        chosen: { 'IntCell@target.stroke': 'violet-500', 'listing.places': 'fill' }
      }
    );
    const scenes = lit.layout.scenes!;
    expect(scenes.frame.places).toHaveProperty('@target', colourCss('violet-500'));
    const step = scenes.steps[1];
    const tokens = step.nodes.flatMap(({ runs = [] }) => runs).filter(({ places }) => places);
    expect(tokens.map(({ text, places }) => [text, places])).toContainEqual([
      'target',
      ['@target']
    ]);
    expect(step.nodes.some(({ places }) => places?.includes('@target'))).toBe(true);
  }
);
