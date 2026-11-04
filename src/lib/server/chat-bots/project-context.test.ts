import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from '$lib/modes/sverlin/compile.server';
import bfs from '$lib/modes/sverlin/fixtures/bfs-visit-order.sverlin?raw';
import bst from '$lib/modes/sverlin/fixtures/bst.sverlin?raw';
import { propOptions } from '$lib/modes/sverlin/library/node/design';
import type { ProjectEvent } from '$lib/shared/projects/events';
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import type { ProjectDocument } from '$lib/shared/projects/model';

import {
  designVariables,
  projectAiContext,
  projectAiTimelineEntry,
  projectConversationMessages
} from './project-context';

const operationId = '12345678-1234-4123-8123-123456789abc';
const sha256 = 'a'.repeat(64);
const recorded = (text: string, mediaType = 'text/plain') => ({ text, sha256, mediaType });

function document(): ProjectDocument {
  return {
    schemaVersion: 1,
    projectId: 'project-test',
    events: [
      {
        id: 1,
        type: 'project.created',
        operationId,
        actor: { kind: 'user' },
        createdAt: '2026-01-01T00:00:01.000Z',
        payload: {
          title: 'Test',
          entryArtifactId: 'main',
          assistantId: 'sverlin-assistant',
          creation: { templateId: 'blank', mode: 'sverlin' }
        }
      },
      {
        id: 2,
        type: 'artifact.version-created',
        operationId,
        actor: { kind: 'system' },
        createdAt: '2026-01-01T00:00:02.000Z',
        payload: {
          origin: { kind: 'initial' },
          changes: [
            {
              operation: 'upsert',
              artifact: {
                artifactId: 'main',
                path: 'Main.svelte',
                language: 'svelte',
                content: recorded('<h1>Hello</h1>', 'text/x-svelte')
              }
            }
          ]
        }
      },
      {
        id: 3,
        type: 'ai.generation-requested',
        operationId,
        actor: { kind: 'system' },
        createdAt: '2026-01-01T00:00:03.000Z',
        payload: {
          attempt: 1,
          purpose: 'initial',
          prompt: recorded('private prompt', 'application/json'),
          promptTemplateSha256: sha256,
          requestedModel: 'test-model',
          parameters: {}
        }
      }
    ]
  };
}

describe('mode-neutral AI project context', () => {
  it('keeps prompt bodies out of the timeline index while expanding selected events', () => {
    const value = document();
    expect(projectAiTimelineEntry(value.events[2]).summary).not.toContain('private prompt');
    expect(JSON.stringify(projectAiContext(value).timeline)).not.toContain('private prompt');
    expect(projectAiContext(value, { eventIds: [3] }).selected.events[0].event).toEqual(
      value.events[2]
    );
  });

  it('gives each system’s assistant the parts of its own interface', () => {
    const parts = (mode: 'sverlin' | 'html') => {
      const value = document();
      const created = value.events[0];
      if (created.type === 'project.created') created.payload.creation.mode = mode;
      return projectAiContext(value).interfaceParts.map(({ id }) => id);
    };
    expect(parts('sverlin')).toEqual(expect.arrayContaining(['answer-buttons', 'choices-panel']));
    expect(parts('html')).toContain('step-controls');
    expect(parts('html')).not.toContain('answer-buttons');
    const [stepControls] = projectAiContext(document()).interfaceParts.filter(
      ({ id }) => id === 'step-controls'
    );
    expect(stepControls).toMatchObject({ name: 'Step controls' });
    expect(stepControls.description).toMatch(/Previous and Next/u);
  });

  it('exposes presentation steps and preference interaction without executable bytes', () => {
    const value = document();
    const presentationId = '12345678-1234-4123-8123-123456789ac1';
    const otherId = '12345678-1234-4123-8123-123456789ac2';
    for (const [slot, id] of [presentationId, otherId].entries()) {
      value.events.push({
        id: slot + 4,
        type: 'visualization.presented',
        operationId,
        actor: { kind: 'system' },
        createdAt: `2026-01-01T00:00:0${slot + 4}.000Z`,
        payload: {
          displaySetId: '12345678-1234-4123-8123-123456789abd',
          slot: slot as 0 | 1,
          presentation: {
            presentationId: id,
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['Start', 'Result'],
            seed: slot + 1,
            source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
            html: recorded('', 'text/html'),
            javascript: recorded('private executable bytes', 'text/javascript')
          }
        }
      });
    }
    value.events.push({
      id: 6,
      type: 'visualization.preference-recorded',
      operationId,
      actor: { kind: 'user' },
      createdAt: '2026-01-01T00:00:06.000Z',
      payload: { presentations: [presentationId, otherId], preferred: presentationId, step: 1 }
    });
    const context = projectAiContext(value, {
      eventIds: [],
      presentationIds: [presentationId, otherId],
      interactionEventIds: [6]
    });
    expect(context.interaction).toMatchObject({
      kind: 'preference',
      preferredPresentationId: presentationId
    });
    expect(context.selected.presentations[0]).toMatchObject({
      presentationId,
      steps: [{ label: 'Start' }, { label: 'Result' }]
    });
    expect(JSON.stringify(context.selected.presentations)).not.toContain(
      'private executable bytes'
    );
    expect(projectConversationMessages(value.events)).toEqual([
      { role: 'user', content: expect.stringContaining(presentationId) }
    ]);
  });

  it('says what a preferred pair differed in, for this turn and in the conversation', () => {
    const value = document();
    const preferredId = '12345678-1234-4123-8123-123456789ac1';
    const otherId = '12345678-1234-4123-8123-123456789ac2';
    const variants = [
      { 'views.Int': 'IntCell', 'root.fill': 'blue-100', 'root.radius': 4 },
      { 'views.Int': 'IntTally', 'root.fill': 'amber-100', 'root.radius': 4 }
    ];
    for (const [slot, id] of [preferredId, otherId].entries())
      value.events.push({
        id: slot + 4,
        type: 'visualization.presented',
        operationId,
        actor: { kind: 'system' },
        createdAt: `2026-01-01T00:00:0${slot + 4}.000Z`,
        payload: {
          displaySetId: '12345678-1234-4123-8123-123456789abd',
          slot: slot as 0 | 1,
          presentation: {
            presentationId: id,
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['Start'],
            seed: slot + 1,
            source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
            html: recorded('', 'text/html'),
            javascript: recorded('', 'text/javascript'),
            variant: variants[slot]
          }
        }
      });
    value.events.push({
      id: 6,
      type: 'visualization.preference-recorded',
      operationId,
      actor: { kind: 'user' },
      createdAt: '2026-01-01T00:00:06.000Z',
      payload: { presentations: [preferredId, otherId], preferred: preferredId, step: 0 }
    });
    const differences = [
      { variable: 'root.fill', preferred: 'blue-100', other: 'amber-100' },
      { variable: 'views.Int', preferred: 'IntCell', other: 'IntTally' }
    ];
    expect(
      projectAiContext(value, { eventIds: [], interactionEventIds: [6] }).interaction
    ).toMatchObject({ kind: 'preference', differences });
    expect(projectConversationMessages(value.events)).toEqual([
      {
        role: 'user',
        content: expect.stringContaining(
          'They differed in root.fill blue-100 (the other: amber-100); views.Int IntCell (the other: IntTally).'
        )
      }
    ]);
  });
});

describe('source versions in the AI context', () => {
  it('lists each source once, with the version it was made from and what it changes', () => {
    const value = document();
    const version = (
      id: number,
      hash: string,
      origin: 'assistant-edit' | 'candidate',
      parent: number,
      summary?: string
    ) => ({
      id,
      type: 'artifact.version-created' as const,
      operationId,
      actor: { kind: 'system' as const },
      createdAt: `2026-01-01T00:00:0${id}.000Z`,
      payload: {
        origin:
          origin === 'candidate'
            ? { kind: origin, presentationId: '12345678-1234-4123-8123-123456789abd' }
            : { kind: origin },
        parent,
        ...(summary ? { summary } : {}),
        changes: [
          {
            operation: 'upsert' as const,
            artifact: {
              artifactId: 'main',
              path: 'Main.svelte',
              language: 'svelte' as const,
              content: { text: hash, sha256: hash.repeat(64), mediaType: 'text/x-svelte' }
            }
          }
        ]
      }
    });
    value.events.push(
      version(4, 'b', 'assistant-edit', 2, 'Shows indices'),
      // Building on the first source again brings it back: it is not a version of its own.
      version(5, 'a', 'candidate', 4),
      version(6, 'c', 'assistant-edit', 5, 'Highlights the target')
    );

    const context = projectAiContext(value);

    expect(context.versions).toEqual([
      { id: 'aaaaaa', eventId: 2, madeBy: 'initial' },
      {
        id: 'bbbbbb',
        eventId: 4,
        parent: 'aaaaaa',
        madeBy: 'assistant-edit',
        summary: 'Shows indices'
      },
      {
        id: 'cccccc',
        eventId: 6,
        parent: 'aaaaaa',
        madeBy: 'assistant-edit',
        summary: 'Highlights the target'
      }
    ]);
    expect(context.base.artifacts[0].sha256).toBe('c'.repeat(64));
    expect(context.timeline.at(-1)?.summary).toBe(
      'Created assistant-edit source version cccccc: Highlights the target.'
    );
  });
});

describe('design variables in the AI context', () => {
  it('gives each label’s runs from the base’s newest build, to pace a new source by', () => {
    const value = document();
    const buildId = '22345678-1234-4123-8123-123456789abc';
    const runs = { check: { runs: 6, drawn: 6 }, missing: { runs: 1, drawn: 0 } };
    value.events.push(
      {
        id: 4,
        type: 'build.requested',
        operationId,
        actor: { kind: 'system' },
        createdAt: '2026-01-01T00:00:04.000Z',
        payload: {
          purpose: 'initial',
          input: 'committed-artifact',
          source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
          sourceLabel: 'Main.svelte',
          seed: 1,
          buildId
        }
      },
      {
        id: 5,
        type: 'build.succeeded',
        operationId,
        actor: { kind: 'system' },
        createdAt: '2026-01-01T00:00:05.000Z',
        payload: { durationMs: 1, buildId, bundle: recorded(JSON.stringify({ runs })) }
      }
    );
    expect(projectAiContext(value).spans).toEqual({
      check: { spans: 6, drawn: 6 },
      missing: { spans: 1, drawn: 0 }
    });
    expect(projectAiContext(document())).not.toHaveProperty('runs');
  });

  it('offers how a listing’s places light its own options', () => {
    const design = designVariables({ variant: { 'listing.places': 'fill' } });
    expect(design.variables[0].options).toBe('listing.places');
    expect(design.options['listing.places']).toEqual(['none', 'fill', 'underline', 'outline']);
  });

  it('offers each layout’s frame its options', () => {
    const design = designVariables({
      variant: {
        'Side.ratio': '16:9',
        'Stacked.ratio': '4:3'
      }
    });
    const options = (key: string) =>
      design.variables.find(({ variable }) => variable === key)?.options;
    expect(options('Side.ratio')).toBe('ratio');
    expect(design.options.ratio).toContain('4:3');
  });

  it('offers the style props exactly their options', () => {
    const { starter } = prepareSvelteComponent(bfs).design;
    const design = designVariables({ variant: starter });
    for (const prop of ['shadow', 'glow', 'fillStyle', 'decoration', 'case'] as const) {
      expect(design.options[prop]).toEqual(propOptions[prop]);
      const variables = design.variables.filter(({ variable }) => variable.endsWith(`.${prop}`));
      expect(variables.length).toBeGreaterThan(0);
      for (const { options } of variables) expect(options).toBe(prop);
    }
  });

  it('offers each free layout exactly the forms and directions its design takes', () => {
    for (const source of [bfs, bst]) {
      const { space, starter } = prepareSvelteComponent(source).design;
      const design = designVariables({ variant: starter });
      const layout = design.variables.filter(({ variable }) =>
        /\.(form|direction)$/u.test(variable)
      );
      expect(layout.length).toBeGreaterThan(0);
      for (const { variable, options } of layout)
        expect(typeof options === 'string' ? design.options[options] : options).toEqual(
          space[variable]
        );
    }
  });
});

describe('comparisons in the conversation', () => {
  it('reads each preference with its comparison’s question and the preferred side’s label', () => {
    const value = document();
    const at = value.events.length;
    const ids = ['12345678-1234-4123-8123-123456789ac1', '12345678-1234-4123-8123-123456789ac2'];
    const displaySetId = '12345678-1234-4123-8123-123456789abd';
    for (const [slot, id] of ids.entries())
      value.events.push({
        id: at + slot + 1,
        type: 'visualization.presented',
        operationId,
        actor: { kind: 'system' },
        createdAt: `2026-01-01T00:00:0${slot + 4}.000Z`,
        payload: {
          displaySetId,
          slot: slot as 0 | 1,
          question: 'Cells or tallies for the numbers?',
          label: slot ? 'tallies' : 'cells',
          presentation: {
            presentationId: id,
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['Start'],
            seed: slot + 1,
            source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
            html: recorded('', 'text/html'),
            javascript: recorded('', 'text/javascript'),
            variant: { 'views.Int': slot ? 'IntTally' : 'IntCell' }
          }
        }
      });
    value.events.push({
      id: at + 3,
      type: 'visualization.preference-recorded',
      operationId,
      actor: { kind: 'user' },
      createdAt: '2026-01-01T00:00:06.000Z',
      payload: { displaySetId, presentations: [ids[0], ids[1]], preferred: ids[1], step: 0 }
    });

    expect(projectConversationMessages(value.events)).toEqual([
      {
        role: 'user',
        content: expect.stringMatching(/^Cells or tallies for the numbers\? → tallies\. /u)
      }
    ]);
    expect(
      projectAiContext(value, { eventIds: [], interactionEventIds: [at + 3] }).interaction
    ).toMatchObject({
      kind: 'preference',
      question: 'Cells or tallies for the numbers?',
      answer: 'tallies'
    });
  });

  /** A designed pair of the starter-free test source, its sides setting views.Int. */
  function pair(value: ProjectDocument, ids: [string, string], displaySetId: string) {
    const at = value.events.length;
    for (const [slot, id] of ids.entries())
      value.events.push({
        id: at + slot + 1,
        type: 'visualization.presented',
        operationId,
        actor: { kind: 'system' },
        createdAt: `2026-01-01T00:00:0${slot + 4}.000Z`,
        payload: {
          displaySetId,
          slot: slot as 0 | 1,
          question: 'Cells or tallies for the numbers?',
          presentation: {
            presentationId: id,
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['Start'],
            seed: slot + 1,
            source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
            html: recorded('', 'text/html'),
            javascript: recorded('', 'text/javascript'),
            variant: { 'views.Int': slot ? 'IntTally' : 'IntCell', 'Cell.fill': 'white' },
            views: { Int: ['IntCell', 'IntTally', 'IntDots'] }
          }
        }
      });
  }

  it('says where a compared pair draws differently, by its steps’ names, as the server found', () => {
    const value = document();
    const ids: [string, string] = [
      '12345678-1234-4123-8123-123456789ac1',
      '12345678-1234-4123-8123-123456789ac2'
    ];
    const displaySetId = '12345678-1234-4123-8123-123456789abd';
    const at = value.events.length;
    for (const [slot, id] of ids.entries())
      value.events.push({
        id: at + slot + 1,
        type: 'visualization.presented',
        operationId,
        actor: { kind: 'system' },
        createdAt: `2026-01-01T00:00:0${slot + 4}.000Z`,
        payload: {
          displaySetId,
          slot: slot as 0 | 1,
          question: 'How large should the marker be?',
          label: slot ? 'larger' : 'smaller',
          differsAt: [1, 2, 4],
          presentation: {
            presentationId: id,
            format: 'browser-bundle-v1',
            mode: 'sverlin',
            stepSignature: 'shared',
            labels: ['start', '@scan.check#1', '@scan.check#2', '@found#1', '@done#1', 'end'],
            seed: slot + 1,
            source: recorded('<h1>Hello</h1>', 'text/x-svelte'),
            html: recorded('', 'text/html'),
            javascript: recorded('', 'text/javascript'),
            variant: { 'Marker.textSize': slot ? 24 : 20 }
          }
        }
      });
    value.events.push(
      {
        id: at + 3,
        type: 'feedback.submitted',
        operationId,
        actor: { kind: 'user' },
        createdAt: '2026-01-01T00:00:06.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'Is there a difference?' }],
          focus: [],
          viewing: {
            presentations: [
              { presentationId: ids[0], step: 0, stepName: 'start' },
              { presentationId: ids[1], step: 0, stepName: 'start' }
            ]
          }
        }
      },
      {
        id: at + 4,
        type: 'visualization.preference-recorded',
        operationId,
        actor: { kind: 'user' },
        createdAt: '2026-01-01T00:00:07.000Z',
        payload: { displaySetId, presentations: ids, preferred: ids[1], step: 1 }
      }
    );
    const differs =
      'the two draw differently only at steps 2–3 (@scan.check#1 to @scan.check#2) and 5 (@done#1), alike at every other step';

    expect(projectConversationMessages(value.events)[0].content).toBe(
      `(comparing presentation ${ids[0]} at step 1, start with presentation ${ids[1]} at step 1, start; ${differs})\nIs there a difference?`
    );
    expect(
      projectAiContext(value, { eventIds: [], interactionEventIds: [at + 4] }).interaction
    ).toMatchObject({ kind: 'preference', differsAt: differs });
  });

  it('reads either is fine as the two being equally good, with the model’s summary', () => {
    const value = document();
    const ids: [string, string] = [
      '12345678-1234-4123-8123-123456789ac1',
      '12345678-1234-4123-8123-123456789ac2'
    ];
    const displaySetId = '12345678-1234-4123-8123-123456789abd';
    pair(value, ids, displaySetId);
    const at = value.events.length;
    value.events.push({
      id: at + 1,
      type: 'visualization.preference-recorded',
      operationId,
      actor: { kind: 'user' },
      createdAt: '2026-01-01T00:00:06.000Z',
      payload: { displaySetId, presentations: ids, outcome: 'tie', step: 0 }
    });
    const [message] = projectConversationMessages(value.events);
    expect(message.content).toMatch(/^Cells or tallies for the numbers\? → either is fine\. /u);
    expect(message.content).toContain('does not matter');
    const context = projectAiContext(value, { eventIds: [], interactionEventIds: [at + 1] });
    expect(context.interaction).toMatchObject({ kind: 'preference', outcome: 'tie' });
    // The model's summary: the tie leaves the numbers' view as either, the fill never compared.
    expect(context.preferences).toMatchObject({
      answered: 1,
      later: 0,
      // Its view has four options (none among them), two compared.
      choices: [{ variable: 'views.Int', state: 'either', compared: 2, unexplored: 2 }],
      unexplored: [{ family: 'colour', count: 1, examples: ['Cell.fill'] }]
    });
  });

  it('reads a question with its reply, and the message answering it with the question', () => {
    const value = document();
    const at = value.events.length;
    value.events.push(
      {
        id: at + 1,
        type: 'assistant.responded',
        operationId,
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        createdAt: '2026-01-01T00:00:06.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'Here it is.' }],
          question: { text: 'Should the swap stand out more?' }
        }
      },
      {
        id: at + 2,
        type: 'feedback.submitted',
        operationId,
        actor: { kind: 'user' },
        createdAt: '2026-01-01T00:00:07.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'Yes, much more.' }],
          focus: [],
          answers: at + 1
        }
      }
    );
    expect(projectConversationMessages(value.events)).toEqual([
      { role: 'assistant', content: 'Here it is.\n[Asked: “Should the swap stand out more?”]' },
      {
        role: 'user',
        content: '[Answering your question “Should the swap stand out more?”] Yes, much more.'
      }
    ]);
  });

  it('notes what was on screen before the participant’s words', () => {
    const value = document();
    const [first, second] = [
      '12345678-1234-4123-8123-123456789ac1',
      '12345678-1234-4123-8123-123456789ac2'
    ];
    const message = (id: number, viewing: FeedbackViewing): ProjectEvent => ({
      id,
      type: 'feedback.submitted',
      operationId,
      actor: { kind: 'user' },
      createdAt: '2026-01-01T00:00:07.000Z',
      payload: {
        content: [{ type: 'markdown', text: 'Make this step clearer.' }],
        focus: [],
        viewing
      }
    });
    const at = value.events.length;
    value.events.push(
      message(at + 1, {
        presentations: [{ presentationId: first, step: 6, stepName: '@search.check#4' }]
      }),
      message(at + 2, {
        presentations: [{ presentationId: first, step: 0 }, { presentationId: second }]
      }),
      message(at + 3, { source: 'abc123' })
    );
    expect(projectConversationMessages(value.events).map(({ content }) => content)).toEqual([
      `(viewing presentation ${first} at step 7, @search.check#4)\nMake this step clearer.`,
      `(comparing presentation ${first} at step 1 with presentation ${second})\nMake this step clearer.`,
      '(viewing source abc123 on its own)\nMake this step clearer.'
    ]);
  });

  it('gives the brief beside the model’s summary, intake’s answer in it, steering the summary', () => {
    const value = document();
    const ids: [string, string] = [
      '12345678-1234-4123-8123-123456789ac1',
      '12345678-1234-4123-8123-123456789ac2'
    ];
    const at = value.events.length;
    value.events.push(
      {
        id: at + 1,
        type: 'assistant.responded',
        operationId,
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        createdAt: '2026-01-01T00:00:04.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'What algorithm would you like to visualise?' }],
          intakeStep: 'algorithm'
        }
      },
      {
        id: at + 2,
        type: 'feedback.submitted',
        operationId,
        actor: { kind: 'user' },
        createdAt: '2026-01-01T00:00:05.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'Bubble sort for printed handouts' }],
          focus: []
        }
      },
      {
        id: at + 3,
        type: 'assistant.responded',
        operationId,
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        createdAt: '2026-01-01T00:00:06.000Z',
        payload: {
          content: [{ type: 'markdown', text: 'Here it is.' }],
          brief: [
            {
              key: 'constraints',
              value: 'printed in grey',
              status: 'inferred',
              source: 'printed handouts',
              tags: ['greyscale']
            }
          ]
        }
      }
    );
    pair(value, ids, '12345678-1234-4123-8123-123456789abd');
    const context = projectAiContext(value, { eventIds: [], interactionEventIds: [] });
    expect(context.brief.attributes[0]).toMatchObject({
      key: 'algorithm',
      status: 'confirmed',
      value: 'Bubble sort for printed handouts'
    });
    expect(context.brief.attributes.find(({ key }) => key === 'constraints')).toMatchObject({
      status: 'inferred',
      source: 'printed handouts',
      prompt: 'confirm',
      decides: ['colour']
    });
    expect(context.brief.avoid).toEqual(['colours: it must print in grey']);
    // The fill, a colour, is no longer offered as unexplored.
    expect(context.preferences?.unexplored.map(({ family }) => family)).not.toContain('colour');
  });
});
