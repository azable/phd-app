import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';

import { helpersHaveRun, viewHelpersContext } from './view-helpers';

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

  it('says plainly whether and when the helpers have run', () => {
    const switched = {
      events: [{ id: 7, type: 'project.view-helpers-set', payload: { enabled: true } }]
    } as unknown as ProjectDocument;
    expect(viewHelpersContext(switched, { sha256: 'w', text: written }).status).toBe(
      'The helpers are on since event 7; no round has run yet.'
    );
    expect(helpersHaveRun(switched)).toBe(false);
    expect(viewHelpersContext(proposed(), { sha256: 'w', text: written }).status).toBe(
      'The helpers are on; 1 round so far, the last at event 2: views of Int, 1 kept, 0 left out.'
    );
  });

  it('shows arrangements of a layout, until one is in place or the layout changes', () => {
    const main = '<Layout name="Main"><Node>{values}</Node></Layout>';
    const row = '<Layout name="Main"><Node layout="row">{values}</Node></Layout>';
    const document = proposed();
    const event = document.events[1] as unknown as { payload: Record<string, unknown> };
    event.payload = {
      ...event.payload,
      type: undefined,
      layout: 'Main',
      candidates: [{ name: 'Main', description: 'in a row', markup: row }]
    };
    const context = viewHelpersContext(document, { sha256: 'w', text: written });
    expect(context).toMatchObject({ layout: 'Main', candidates: [{ markup: row }] });
    const placed = written.replace(main, row);
    expect(names(viewHelpersContext(document, { sha256: 'p', text: placed }))).toEqual([]);
  });

  it('drops one the source now has, as offered, and all once their type’s views change', () => {
    const offered = written.replace(cell, `${cell}\n${dot}`);
    expect(names(viewHelpersContext(proposed(), { sha256: 'o', text: offered }))).toEqual([]);
    const restyled = written.replace('<Node value={this} />', '<Node>{this}</Node>');
    expect(names(viewHelpersContext(proposed(), { sha256: 'r', text: restyled }))).toEqual([]);
  });
});
