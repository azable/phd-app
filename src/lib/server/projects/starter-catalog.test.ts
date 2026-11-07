import { describe, expect, it } from 'vitest';

import { compileSvelteComponent } from '$lib/modes/sverlin/compile.server';

import {
  getProjectTemplate,
  listProjectTemplates,
  resolveProjectTemplate,
  UnknownProjectTemplateError
} from './starter-catalog';

describe('starter catalog', () => {
  it('offers only developer-owned, buildable components', async () => {
    expect(listProjectTemplates().map(({ id }) => id)).toEqual(['blank', 'linear-search']);
    const blank = resolveProjectTemplate({ templateId: 'blank' });
    // The blank source's one scene reads no state: one frame, named by the scene.
    expect(
      (await compileSvelteComponent(blank.source, { chosen: { template: '$starter' } })).labels
    ).toEqual(['main']);
    expect(
      (
        await compileSvelteComponent(getProjectTemplate('linear-search').source, {
          chosen: { template: '$starter' }
        })
      ).labels
    ).toHaveLength(11);
  });

  it('rejects unknown templates and mode-incompatible examples', () => {
    expect(() => getProjectTemplate('not-catalogued')).toThrow(UnknownProjectTemplateError);
    expect(() => resolveProjectTemplate({ templateId: 'linear-search', mode: 'html' })).toThrow(
      'only for the Svelte-backed mode'
    );
  });
});
