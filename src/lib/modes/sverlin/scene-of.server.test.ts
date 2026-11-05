/**
 * Scenes drawn on the server (see library/model/scene-of.ts) of one part, with other design
 * values, from a build's layout code alone (see scenesOnServer): only the nodes of the part and what
 * is inside them, drawn with the values asked for, at the steps asked for.
 */

import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import { scenesOnServer } from './layout.server';
import { pausingEveryLabel } from './testing/every-pause';

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
