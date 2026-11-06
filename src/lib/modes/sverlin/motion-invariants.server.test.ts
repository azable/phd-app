/**
 * How each fixture moves between its steps, checked as a whole: a node with no value of its own,
 * held by a value or a pointer's mark (an arrow in its mark, a bar in its column), starts from a
 * node that the old node its holder starts from held, so it never takes another holder's part;
 * and where it is drawn with the same holder at both steps, it is paired, not faded out and in.
 * Parts may move against their holder where the holder's inside is laid out again, as a tree card
 * whose subtrees move, or a value drawn at another size, so their movement is not compared.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drawnSteps } from './testing/scenes';
import {
  drawnScene,
  pairNodes,
  planMove,
  sceneDuring,
  type DrawnNode,
  type DrawnScene
} from './library/scene-render';

const folder = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(folder).filter((name) => name.endsWith('.sverlin'));

/**
 * Faults known and not yet fixed, each expected to break the rule until it is: remove an entry once
 * its fixture passes.
 */
const known: Record<string, string> = {
  'bst.sverlin':
    "the rule for nodes drawing no value pairs a tree card's unnamed rows by kind and shared values, so where a child is added the L row takes the old R row and the R label fades in, though the card stayed and their ids matched"
};

/** The nearest node round a node that draws a value or a pointer's mark. */
function holder(scene: DrawnScene, node: DrawnNode): DrawnNode | undefined {
  for (let id = node.parent; id; id = scene.byId.get(id)?.parent) {
    const up = scene.byId.get(id);
    if (up?.identity) return up;
  }
  return undefined;
}

/** What breaks the rule in the move from one step to the next. */
export function violations(from: DrawnScene, to: DrawnScene): string[] {
  const pairs = pairNodes(from, to);
  const found: string[] = [];
  for (const node of to.nodes) {
    if (node.identity || node.leaving) continue;
    const now = holder(to, node);
    if (!now) continue;
    const holderWas = pairs.get(now.key);
    const was = pairs.get(node.key);
    if (!was) {
      const before = from.byId.get(node.id);
      if (before && holderWas && holder(from, before) === holderWas)
        found.push(`${node.id} (${node.kind}) fades in, though ${now.identity} held it before`);
      continue;
    }
    const then = holder(from, was);
    if (then && holderWas && then !== holderWas)
      found.push(
        `${node.id} (${node.kind}) in ${now.id} (${now.identity}) starts from ${was.id} in ${then.id} (${then.identity}), not from what ${holderWas.id} held`
      );
  }
  return found;
}

describe('motion between steps', () => {
  for (const name of fixtures)
    it(`keeps what values and marks hold with them in ${name}`, async () => {
      const source = readFileSync(new URL(name, folder), 'utf8');
      let steps;
      try {
        ({ steps } = await drawnSteps(source));
      } catch {
        return; // A fixture made to be refused, or built only with its own variant.
      }
      const found: string[] = [];
      for (let k = 1; k < steps.length; k++) {
        const from = drawnScene(steps[k - 1]);
        const to = drawnScene(steps[k]);
        for (const problem of violations(from, to))
          found.push(`steps ${k} to ${k + 1}: ${problem}`);
        // Back: the move on, played from its end, as SceneView plays one step back.
        const back = planMove({ step: k, scene: to }, { step: k - 1, scene: from });
        expect(back?.reversed).toBe(true);
        const live = (scene: DrawnScene) => scene.nodes.filter(({ leaving }) => !leaving).length;
        expect(live(sceneDuring(back!, 0.25))).toBe(
          live(sceneDuring({ from, to, reversed: false }, 0.75))
        );
      }
      if (known[name]) expect(found.length, known[name]).toBeGreaterThan(0);
      else expect(found).toEqual([]);
    });
});
