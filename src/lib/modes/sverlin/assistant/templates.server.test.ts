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
    designPatch(JSON.stringify({ template: templateName(name) })).set.map(({ variable, value }) => [
      keptKey(variable),
      value
    ])
  );

describe('templates', () => {
  it('are named by a patch, which the build copies, and a base at the top is refused', () => {
    const patch = readDesignPatch(JSON.stringify({ template: '$textbook', $accent: '#E69F00' }));
    expect(patch).toEqual({
      set: [
        { variable: 'template', value: '$textbook' },
        { variable: '$accent', value: '#E69F00' }
      ],
      remove: []
    });
    const based = readDesignPatch(JSON.stringify({ '...': '$textbook' }));
    expect('problem' in based && based.problem).toMatch(
      /"\.\.\." at the top named a base the design followed, which is gone/u
    );
  });

  it.each(names)('%s builds every fixture with no value refused or left out', async (name) => {
    for (const source of [bfs, dijkstra, pseudocode, bars]) {
      const { built } = await drawnSteps(source, { chosen: chosenFor(name) });
      expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/left out/u));
      expect(built.design).not.toHaveProperty('template');
      expect(built.design.$text).toBe(templateValues(name).$text);
    }
  });

  it('are told to the assistant as the stored file, as it is', () => {
    const variant = { ...templateValues('slide'), '<Value>.radius': 0, 'IntCell.fill': 'white' };
    const told = designContext(designVariables({ variant, design: variant } as never));
    expect(told.file).toMatchObject({ '<Value>': { radius: 0 }, IntCell: { fill: 'white' } });
    expect((told.file.scale as Record<string, unknown>).spacing).toBe(
      templateValues('slide')['scale.spacing']
    );
    expect(told.variables.map(({ variable }) => variable)).not.toContain('$text');
  });

  // Principle 4 (assistant.md, Templates): text at least 4.5:1 on its fill, and the lines needed to
  // read the picture at least 3:1 on the page. The starter keeps the app's first look, which breaks it.
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
