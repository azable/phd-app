import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
import { timelinePresentations } from '$lib/client/visualization/presentation-history';
import { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
import type { ProjectEvent } from '$lib/shared/projects/events';
import type { MessageContent } from '$lib/shared/projects/events/message-content';

import ParticipantTimeline from './ParticipantTimeline.svelte';

const operationId = '12345678-1234-4123-8123-123456789abc';
const displaySetId = '12345678-1234-4123-8123-123456789abd';
const ids = ['12345678-1234-4123-8123-123456789ac1', '12345678-1234-4123-8123-123456789ac2'];

describe('participant timeline', () => {
  it('shows a turn as one message: its reply, its versions’ pills with their actions, and its question', () => {
    const body = timeline(
      turn([{ type: 'markdown', text: 'Adds the digits.' }], {
        question: { text: 'Who is it for?' }
      })
    );
    // One assistant message, which holds everything the turn did.
    expect(body.match(/<article/g)).toHaveLength(1);
    expect(body).toContain('Adds the digits.');
    // The question is the reply's last paragraph, emphasised, with no hint how to answer it.
    expect(body).toMatch(/<p class="[^"]*font-medium[^"]*">(?:<[^>]*>|\s)*Who is it for\?/u);
    expect(body.lastIndexOf('aria-label="View ')).toBeLessThan(body.indexOf('Who is it for?'));
    expect(body).not.toContain('Answer in the chat');
    // Neither version is named in the reply, so both are appended, each with its actions.
    expect(body.match(/aria-label="View /g)).toHaveLength(2);
    expect(body.match(/aria-label="Show the source of /g)).toHaveLength(2);
    expect(body.match(/aria-label="Add [^"]* to feedback"/g)).toHaveLength(2);
    // The version's summary is the pill's tooltip, not a line of its own.
    expect(body).toContain('title="Counts each step');
    expect(body).not.toContain('View variant');
  });

  it('draws a pill the reply names in place, and no other', () => {
    const body = timeline(
      turn([
        { type: 'markdown', text: 'Counting:' },
        { type: 'presentation-ref', presentationId: ids[0] },
        { type: 'markdown', text: 'and' },
        { type: 'presentation-ref', presentationId: ids[1] }
      ])
    );
    expect(body.match(/aria-label="View /g)).toHaveLength(2);
    expect(body.indexOf('Counting:')).toBeLessThan(body.indexOf('aria-label="View '));
  });

  it('shows a comparison in its message: the question, each side by its label, marked by the answer', () => {
    const body = timeline(
      turn([{ type: 'markdown', text: 'Two looks to compare.' }], {
        pair: { question: 'Cells or tallies?', labels: ['cells', 'tallies'] },
        answered: true
      })
    );
    expect(body.match(/<article/g)).toHaveLength(1);
    expect(body).toContain('Cells or tallies?');
    expect(body).toMatch(/Your choice:.*cells:.*Not chosen:.*tallies:/su);
    expect(body).not.toContain('→');
  });

  const comparison = (answers: (string | 'tie' | 'skip')[] = []) => [
    ...turn([{ type: 'markdown', text: 'Two looks to compare.' }], {
      pair: { question: 'Cells or tallies?', labels: ['cells', 'tallies'] }
    }),
    ...answers.map(
      (answer, index) =>
        ({
          id: 6 + index,
          operationId: '22345678-1234-4234-8234-123456789abc',
          createdAt: `2026-08-30T00:00:0${6 + index}.000Z`,
          type: 'visualization.preference-recorded',
          actor: { kind: 'user' },
          payload: {
            displaySetId,
            presentations: [...ids],
            step: 0,
            ...(answer === 'tie' || answer === 'skip' ? { outcome: answer } : { preferred: answer })
          }
        }) as ProjectEvent
    )
  ];
  const heading = (body: string) =>
    body.match(
      /<button[^>]*title="Show this comparison"[^>]*>(?:<[^>]*>|\s)*Cells or tallies\?.*?<\/button>/su
    )?.[0];

  it('makes a comparison’s question a button over its card that shows its pair, selected while it shows', () => {
    const events = comparison([ids[0]]);
    expect(heading(timeline(events))).toContain('after:absolute after:inset-0');
    expect(heading(timeline(events))).not.toContain('aria-current');
    expect(heading(timeline(events, { open: true }))).toContain('aria-current="true"');
    // A source chosen on its own hides the stage, so the comparison is no longer open.
    const hidden = timeline(events, { open: true, chosenSource: 'a'.repeat(64) });
    expect(heading(hidden)).not.toContain('aria-current');
  });

  it('selects the current comparison, which the stage shows on its own', () => {
    expect(heading(timeline(comparison()))).toContain('aria-current="true"');
  });

  it('marks a changed answer by the latest', () => {
    const body = timeline(comparison([ids[0], ids[1]]));
    expect(body).toMatch(/Not chosen:.*cells:.*Your choice:.*tallies:/su);
    expect(body.match(/Your choice:/g)).toHaveLength(1);
    expect(body.match(/<article/g)).toHaveLength(1);
  });

  it('ticks both sides when either is fine, and marks both unsure in the same place', () => {
    const tie = timeline(comparison(['tie']));
    expect(tie.match(/Your choice:/g)).toHaveLength(2);
    expect(tie).not.toContain('Not chosen:');
    const unsure = timeline(comparison(['skip']));
    expect(unsure).not.toMatch(/Your choice:|Not chosen:/);
    expect(unsure.match(/Unsure:/g)).toHaveLength(2);
    const unanswered = timeline(comparison([]));
    expect(unanswered.match(/Not answered:/g)).toHaveLength(2);
  });

  it('renders questions and side labels as inline Markdown, with no blocks in a button', () => {
    const pair = timeline(
      turn([{ type: 'markdown', text: 'Two looks to compare.' }], {
        pair: { question: 'Should the marker carry `i`?', labels: ['with `i`', 'without'] }
      })
    );
    expect(pair).not.toContain('`');
    const button = pair.match(/<button[^>]*title="Show this comparison"[^>]*>.*?<\/button>/su)?.[0];
    expect(button).toMatch(/Should the marker carry .*<code>i<\/code>\?/su);
    expect(button).not.toMatch(/<(p|div)[\s>]/);
    expect(pair).toMatch(/with .*<code>i<\/code>:/su);
    const words = timeline(
      turn([{ type: 'markdown', text: 'Adds the digits.' }], {
        question: { text: 'Keep the **carry** in `sum`?' }
      })
    );
    expect(words).toMatch(/Keep the .*<strong>carry<\/strong> in .*<code>sum<\/code>\?/su);
    expect(words).not.toContain('`');
  });
  it('captions no answer in words, the next message being the answer', () => {
    const body = timeline([
      ...turn([{ type: 'markdown', text: 'Adds the digits.' }], {
        question: { text: 'Who is it for?' }
      }),
      {
        id: 6,
        operationId: '22345678-1234-4234-8234-123456789abc',
        createdAt: '2026-08-30T00:00:06.000Z',
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        payload: { content: [{ type: 'markdown', text: 'Students' }], focus: [], answers: 2 }
      }
    ]);
    expect(body.match(/<article/g)).toHaveLength(2);
    expect(body).toContain('Students');
    expect(body).not.toContain('→');
  });

  it('ends a question about a presentation the reply does not name with its pill', () => {
    const body = timeline(
      turn([{ type: 'markdown', text: 'Adds the digits.' }], {
        question: { text: 'Too dense?', presentationId: ids[1] }
      })
    );
    const question = body.slice(body.indexOf('Too dense?'));
    // Only the other version is appended to the reply; this one ends the question.
    expect(body.match(/aria-label="View /g)).toHaveLength(2);
    expect(question.match(/aria-label="View /g)).toHaveLength(1);
    expect(question.indexOf('aria-label="View ')).toBeLessThan(question.indexOf('</p>'));
  });
});

/** The timeline's markup; open, with the stage showing its pair as chosen from the timeline. */
function timeline(
  events: ProjectEvent[],
  options: { open?: boolean; chosenSource?: string } = {}
): string {
  const selection = new PresentationSelection(true, undefined, true);
  if (options.open)
    selection.showPair(
      timelinePresentations(events).filter((entry) => entry.displaySetId === displaySetId),
      events,
      'comparison'
    );
  const session = {
    events,
    userAuthorLabel: 'You',
    readOnly: false,
    pending: null,
    pendingEvent: null,
    assistantResponding: false,
    refillPending: false,
    refillError: false
  } as unknown as ProjectSession;
  return render(ParticipantTimeline, {
    props: {
      session,
      selection,
      layout: 'comparison',
      ...(options.chosenSource ? { chosenSource: options.chosenSource } : {})
    }
  }).body;
}

/** One assistant turn: its reply, then a summarised version presented as a pair. */
function turn(
  content: MessageContent,
  options: {
    question?: { text: string; presentationId?: string };
    pair?: { question: string; labels: [string, string] };
    answered?: boolean;
  } = {}
): ProjectEvent[] {
  const envelope = (id: number) => ({
    id,
    operationId,
    createdAt: `2026-08-30T00:00:0${id}.000Z`
  });
  const source = { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' };
  return [
    {
      ...envelope(1),
      type: 'project.created',
      actor: { kind: 'user' },
      payload: { entryArtifactId: 'main' }
    } as unknown as ProjectEvent,
    {
      ...envelope(2),
      type: 'assistant.responded',
      actor: { kind: 'assistant', botId: 'sverlin-assistant' },
      payload: { content, ...(options.question ? { question: options.question } : {}) }
    },
    {
      ...envelope(3),
      type: 'artifact.version-created',
      actor: { kind: 'assistant', botId: 'sverlin-assistant' },
      payload: {
        origin: { kind: 'assistant-edit' },
        summary: 'Counts each step',
        changes: [
          {
            operation: 'upsert',
            artifact: { artifactId: 'main', content: source }
          }
        ]
      }
    } as unknown as ProjectEvent,
    ...ids.map(
      (presentationId, slot): ProjectEvent => ({
        ...envelope(4 + slot),
        type: 'visualization.presented',
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        payload: {
          displaySetId,
          slot: slot as 0 | 1,
          ...(options.pair
            ? { question: options.pair.question, label: options.pair.labels[slot] }
            : {}),
          presentation: {
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['Only step'],
            source,
            html: { text: '', sha256: 'c'.repeat(64), mediaType: 'text/html' },
            javascript: { text: 'void 0;', sha256: 'b'.repeat(64), mediaType: 'text/javascript' },
            presentationId,
            seed: slot + 1,
            variant: { 'views.Int': slot ? 'IntTally' : 'IntCell' }
          }
        }
      })
    ),
    ...(options.answered
      ? [
          {
            id: 6,
            operationId: '22345678-1234-4234-8234-123456789abc',
            createdAt: '2026-08-30T00:00:06.000Z',
            type: 'visualization.preference-recorded',
            actor: { kind: 'user' },
            payload: { displaySetId, presentations: [...ids], preferred: ids[0], step: 0 }
          } as ProjectEvent
        ]
      : [])
  ];
}
