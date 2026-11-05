import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';

import { viewHelpersContext } from './view-helpers';

const cell = '<View of="Int" name="Cell"><Node value={this} /></View>';
const dot = '<View of="Int" name="Dot"><Node value={this} /></View>';
const written = `${cell}\n<Layout name="Main"><Node>{values}</Node></Layout>`;

/** A project whose helpers proposed Dot for the source written, then replied `replies` times. */
function proposed(replies = 0) {
  const events = [
    {
      id: 1,
      type: 'artifact.version-created',
      payload: {
        changes: [{ operation: 'upsert', artifact: { content: { sha256: 'w', text: written } } }]
      }
    },
    {
      id: 2,
      type: 'visualization.view-candidates',
      payload: {
        sourceSha256: 'w',
        type: 'Int',
        generationEventIds: [],
        candidates: [{ name: 'Dot', description: 'a dot', markup: dot }],
        dropped: []
      }
    },
    ...Array.from({ length: replies }, (_, index) => ({
      id: 3 + index,
      type: 'assistant.responded',
      payload: { content: [] }
    }))
  ];
  return { events } as unknown as ProjectDocument;
}

const names = (context: ReturnType<typeof viewHelpersContext>) =>
  context.candidates.map(({ name }) => name);

describe('the view helpers in the assistant context', () => {
  it('keeps candidates not yet offered, counting the replies that passed them by', () => {
    const context = viewHelpersContext(proposed(2), { sha256: 'w', text: written });
    expect(names(context)).toEqual(['Dot']);
    expect(context.repliesSince).toBe(2);
  });

  it('keeps them through a change that leaves their type’s views alone', () => {
    const edited = written.replace('{values}', 'Values: {values}');
    expect(names(viewHelpersContext(proposed(), { sha256: 'e', text: edited }))).toEqual(['Dot']);
  });

  it('drops one the source now has, as offered, and all once their type’s views change', () => {
    const offered = written.replace(cell, `${cell}\n${dot}`);
    expect(names(viewHelpersContext(proposed(), { sha256: 'o', text: offered }))).toEqual([]);
    const restyled = written.replace('<Node value={this} />', '<Node>{this}</Node>');
    expect(names(viewHelpersContext(proposed(), { sha256: 'r', text: restyled }))).toEqual([]);
  });
});
