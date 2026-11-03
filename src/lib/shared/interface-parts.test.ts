import { describe, expect, it } from 'vitest';

import { modeCatalog } from '$lib/modes/catalog';

import { interfaceParts, interfacePartsFor, interfaceReferenceFor } from './interface-parts';
import { plainMessageText } from './projects/events/message-content';

describe('interface parts', () => {
  it('lists the parts each system has', () => {
    expect(interfacePartsFor('sverlin').map(({ id }) => id)).toEqual(
      interfaceParts.map(({ id }) => id)
    );
    {
      expect(interfacePartsFor('html').map(({ id }) => id)).toEqual([
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

  it('keeps a reply’s reference to a part the system has, and names any other in words', () => {
    expect(interfaceReferenceFor('answer-buttons', 'sverlin')).toEqual({
      type: 'interface-ref',
      part: 'answer-buttons'
    });
    expect(interfaceReferenceFor('answer-buttons', 'html')).toEqual({
      type: 'markdown',
      text: 'Answer buttons'
    });
    expect(interfaceReferenceFor('step-controls', 'html')).toMatchObject({ type: 'interface-ref' });
    expect(plainMessageText([{ type: 'interface-ref', part: 'step-controls' }])).toBe(
      '[Interface part step-controls: Step controls]'
    );
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
