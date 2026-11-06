import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';

import { helpersHaveRun, viewHelpersContext } from './context.server';

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

describe('candidates prepared for an offered answer', () => {
  const skeleton = '<Hole name="picture" kind="any" task="t" />';
  const bars = '<View of="Int" name="Bar"><Node height={this} /></View>';
  /** Whole-picture rounds: one the app started, one for an answer, then a message. */
  function prepared(message?: string) {
    const round = (id: number, name: string, option?: { question: number; label: string }) => ({
      id,
      type: 'visualization.view-candidates',
      payload: {
        sourceSha256: 'w',
        skeleton,
        generationEventIds: [],
        candidates: [{ name, description: name, markup: '', fills: { picture: bars } }],
        dropped: [],
        ...(option ? { option } : {})
      }
    });
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
        type: 'assistant.responded',
        payload: {
          content: [],
          question: {
            text: 'What should learners notice first?',
            options: [{ label: 'The comparisons', task: 'comparisons' }, { label: 'The index' }]
          }
        }
      },
      round(3, 'Plain'),
      round(4, 'Compared', { question: 2, label: 'The comparisons' }),
      ...(message
        ? [
            {
              id: 5,
              type: 'feedback.submitted',
              payload: { content: [{ type: 'markdown', text: message }], focus: [], answers: 2 }
            }
          ]
        : [])
    ];
    return { events } as unknown as ProjectDocument;
  }

  it('gives the round prepared for the answer just given', () => {
    const context = viewHelpersContext(prepared('the comparisons'), { sha256: 'w', text: written });
    expect(names(context)).toEqual(['Compared']);
    expect(context.answer).toBe('The comparisons');
  });

  it('gives the latest round prepared for no answer otherwise', () => {
    for (const message of [undefined, 'The index', 'Something else']) {
      const context = viewHelpersContext(prepared(message), { sha256: 'w', text: written });
      expect(names(context)).toEqual(['Plain']);
      expect(context.answer).toBeUndefined();
    }
  });

  it('drops a prepared round once the source changes', () => {
    const edited = written.replace('{values}', 'Values: {values}');
    expect(
      names(viewHelpersContext(prepared('The comparisons'), { sha256: 'e', text: edited }))
    ).toEqual([]);
  });

  it('says what the first round tries, by the first-turns flow', () => {
    const on = viewHelpersContext(prepared(), { sha256: 'w', text: written });
    const off = viewHelpersContext(
      prepared(),
      { sha256: 'w', text: written },
      { firstTurns: { flow: false, caching: false } }
    );
    expect(on.note).toContain('they try whole pictures');
    expect(off.note).toContain('they run on its main type');
    expect(off.firstTurns).toEqual({ flow: false, caching: false });
  });
});
