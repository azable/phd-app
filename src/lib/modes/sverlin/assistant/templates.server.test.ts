import { describe, expect, it } from 'vitest';

import { contrast } from '../library/colour';
import { colourCss } from '../library/node/design';
import { drawnSteps } from '../testing/scenes';
import bfs from '../fixtures/bfs-visit-order.sverlin?raw';
import dijkstra from '../fixtures/dijkstra-fields.sverlin?raw';
import pseudocode from '../fixtures/listing-pseudocode.sverlin?raw';
import bars from '../fixtures/bars.sverlin?raw';
import { keptKey } from '../library/node/design-keys';
import { designContext, designVariables } from './context.server';
import { designPatch, readDesignPatch } from './design-patch.server';
import { templateName, templates, templateValues, type TemplateName } from '../templates/templates';

const names = Object.keys(templates) as TemplateName[];
// As a decision's values become a build's chosen values (designValues in turn.server.ts).
const chosenFor = (name: TemplateName) =>
  Object.fromEntries(
    designPatch(JSON.stringify({ '...': templateName(name) })).set.map(({ variable, value }) => [
      keptKey(variable),
      value
    ])
  );

describe('templates', () => {
  it('are written out in full under the values a design sets itself', () => {
    const patch = readDesignPatch(JSON.stringify({ '...': '$textbook', $accent: '#E69F00' }));
    expect('problem' in patch).toBe(false);
    if ('problem' in patch) return;
    const set = Object.fromEntries(patch.set.map(({ variable, value }) => [variable, value]));
    expect(set.base).toBe('$textbook');
    expect(set['<Value>.font']).toBe('$font');
    expect(set['scale.radius']).toBe('0 999');
    expect(set.$accent).toBe('#E69F00');
    expect(Object.keys(set).length).toBe(Object.keys(templateValues('textbook')).length + 1);
  });

  it('take a base of the model’s own, and refuse a name that is neither', () => {
    const own = readDesignPatch(JSON.stringify({ '...': '$mine', '<Value>': { radius: 4 } }));
    expect('problem' in own).toBe(false);
    const typo = readDesignPatch(JSON.stringify({ '...': '$texbook' }));
    expect('problem' in typo && typo.problem).toMatch(/no template \(<starter>, \$textbook/u);
  });

  it.each(names)('%s builds every fixture with no value refused or left out', async (name) => {
    for (const source of [bfs, dijkstra, pseudocode, bars]) {
      const { built } = await drawnSteps(source, { chosen: chosenFor(name) });
      expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/left out/u));
      expect(built.variant?.base).toBe(templateName(name));
    }
  });

  it('are told to the assistant by name, with only the values that differ from them', () => {
    const variant = { ...chosenFor('slide'), '<Value>.radius': 0, 'IntCell.fill': 'white' };
    const told = designContext(designVariables({ variant } as never));
    const named = told.variables.map(({ variable }) => variable);
    expect(named).toContain('base');
    expect(named).not.toContain('scale.spacing');
    // A style is told among the levels: only the value set apart from the template's.
    expect(told.levels?.['<Value>']).toEqual({ radius: 0 });
    expect(told.levels?.$text).toBeUndefined();
  });

  it('starter, named by the model, draws every fixture as the base the app writes in', async () => {
    for (const source of [bfs, dijkstra, pseudocode, bars]) {
      const plain = await drawnSteps(source);
      const based = await drawnSteps(source, { chosen: chosenFor('starter') });
      expect(JSON.stringify(based.steps)).toBe(JSON.stringify(plain.steps));
    }
  });

  // Principle 4 (assistant.md, Templates): text at least 4.5:1 on its fill, and the lines needed to
  // read the picture at least 3:1 on the page. The starter keeps today's look, which breaks it.
  it.each(names.filter((name) => name !== 'starter'))(
    '%s gives text and lines the contrast it states',
    (name) => {
      const values = templateValues(name);
      const resolve = (value: unknown) =>
        colourCss(typeof value === 'string' && value.startsWith('$') ? values[value] : value);
      const page = '#ffffff';
      for (const role of ['<Value>', '<Text>', '<Container>']) {
        const text = resolve(values[`${role}.color`])!;
        const fill = resolve(values[`${role}.fill`]) ?? page;
        expect(contrast(text, fill), `${name} ${role} text`).toBeGreaterThanOrEqual(4.5);
        const stroke = resolve(values[`${role}.stroke`]);
        if (stroke) expect(contrast(stroke, page), `${name} ${role}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(resolve(values['<Link>.stroke'])!, page)).toBeGreaterThanOrEqual(3);
      // What a link from a variable reaches: text on its fill, and its stroke on the page.
      const target = resolve(values['<Pointer>.<To>.fill']) ?? page;
      const text = resolve(values['<Text>.color'])!;
      expect(contrast(text, target), `${name} target text`).toBeGreaterThanOrEqual(4.5);
      const edge = resolve(values['<Pointer>.<To>.stroke'])!;
      expect(contrast(edge, page), `${name} target stroke`).toBeGreaterThanOrEqual(3);
    }
  );
});
