import { describe, expect, it } from 'vitest';

import { modeCatalog } from '$lib/modes/catalog';

import { interfaceParts, interfacePartsFor } from './interface-parts';

describe('interface parts', () => {
  it('lists the parts each system has', () => {
    expect(interfacePartsFor('sverlin').map(({ id }) => id)).toEqual(
      interfaceParts.map(({ id }) => id)
    );
    for (const mode of ['html', 'html-js'] as const) {
      expect(interfacePartsFor(mode).map(({ id }) => id)).toEqual([
        'timeline',
        'version-pill',
        'stage',
        'step-controls',
        'source-panel',
        'message-box',
        'return-to-present',
        'help'
      ]);
    }
  });

  it('names no system, keeping the study blind', () => {
    const named = [...Object.keys(modeCatalog), ...Object.values(modeCatalog).map((m) => m.title)];
    for (const mode of Object.keys(modeCatalog) as (keyof typeof modeCatalog)[]) {
      for (const { name, description } of interfacePartsFor(mode)) {
        for (const word of [...named, 'Svelte', 'HTML', 'JavaScript']) {
          expect(`${name} ${description}`.toLowerCase()).not.toContain(word.toLowerCase());
        }
      }
    }
  });
});
