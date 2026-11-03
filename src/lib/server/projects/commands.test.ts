import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import {
  markdownMessage,
  type ElementReference
} from '$lib/shared/projects/events/message-content';
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import type { ProjectEvent, ProjectEventOf } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { presentationStepName, type BrowserBundlePresentation } from '$lib/shared/presentations';

import type { ProjectCommandDependencies } from './commands';
import { MemoryProjectRepository } from './memory-repository.test-support';
import { runWithProjectOperationSignal } from './operation-context';
import type { ProjectServiceDependencies } from './service';

const mocks = vi.hoisted(() => ({
  attemptProfiles: [
    {
      purpose: 'initial' as const,
      parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' as const }
    },
    {
      purpose: 'repair' as const,
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' as const }
    },
    {
      purpose: 'repair' as const,
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'high' as const }
    },
    {
      purpose: 'repair' as const,
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' as const }
    },
    {
      purpose: 'fallback' as const,
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' as const }
    }
  ],
  preparePrompt: vi.fn(),
  generatePrepared: vi.fn()
}));

vi.mock('$lib/server/chat-bots/registry', () => ({
  assistantIntroduction: (assistantId: string) => ({
    botId: assistantId,
    text: 'Tell me what you would like to visualize.'
  }),
  getChatbot: () => ({
    config: { attemptProfiles: mocks.attemptProfiles },
    preparePrompt: mocks.preparePrompt,
    generatePrepared: mocks.generatePrepared,
    requestTimeoutMs: () => 180_000
  }),
  getCandidateChatbot: () => ({
    config: { attemptProfiles: mocks.attemptProfiles },
    preparePrompt: mocks.preparePrompt,
    generatePrepared: mocks.generatePrepared,
    requestTimeoutMs: () => 180_000
  }),
  // No chooser unless a test gives one, so a turn shows its first build.
  getSverlinChooser: () => undefined,
  getParticipantIntakeClassifier: () => ({
    config: {
      participantIntake: [{ id: 'algorithm', question: 'Test' }],
      attemptProfiles: [
        {
          purpose: 'intake' as const,
          parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' as const }
        }
      ]
    },
    preparePrompt: mocks.preparePrompt,
    generatePrepared: mocks.generatePrepared,
    requestTimeoutMs: () => 180_000
  })
}));
vi.mock('./fingerprints', () => ({
  sourceSha256: (_value: string) => 'e'.repeat(64),
  recordText: (text: string, mediaType: string) => ({
    text,
    mediaType,
    sha256: 'e'.repeat(64)
  })
}));

let serviceDependencies: ProjectServiceDependencies;
let commandDependencies: ProjectCommandDependencies;

beforeEach(() => {
  mocks.preparePrompt.mockReset().mockImplementation(async ({ attempt = 1 }) => {
    const profile = mocks.attemptProfiles[attempt - 1];
    return {
      initialPrompt: 'test prompt',
      messages: [],
      context: {},
      attempt: { number: attempt, purpose: profile?.purpose ?? 'repair' },
      parameters: profile?.parameters ?? { model: 'test-model' },
      responseFormat: { name: 'test', schema: {} }
    };
  });
  mocks.generatePrepared
    .mockReset()
    .mockImplementation(async (prompt) =>
      generation(
        `broken attempt ${prompt.attempt.number}`,
        `Candidate ${prompt.attempt.number}`,
        prompt.attempt.purpose === 'fallback'
          ? { struggledWith: 'the requested layout', simplified: 'the layout and animation' }
          : undefined
      )
    );

  const repository = new MemoryProjectRepository();
  serviceDependencies = {
    repository
  };
  commandDependencies = {
    repository,
    projectService: serviceDependencies,
    // Comparisons keep the assistant's order unless a test draws otherwise.
    comparisonOrder: () => 0,
    getChatbot: () =>
      ({
        config: { attemptProfiles: mocks.attemptProfiles },
        preparePrompt: mocks.preparePrompt,
        generatePrepared: mocks.generatePrepared,
        requestTimeoutMs: () => 180_000
      }) as unknown as ReturnType<ProjectCommandDependencies['getChatbot']>,
    getCandidateChatbot: () =>
      ({
        config: { attemptProfiles: mocks.attemptProfiles },
        preparePrompt: mocks.preparePrompt,
        generatePrepared: mocks.generatePrepared,
        requestTimeoutMs: () => 180_000
      }) as unknown as ReturnType<ProjectCommandDependencies['getCandidateChatbot']>,
    getParticipantIntakeClassifier: () =>
      ({
        config: {
          participantIntake: [{ id: 'algorithm', question: 'Test' }],
          attemptProfiles: [
            {
              purpose: 'intake',
              parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' }
            }
          ]
        },
        preparePrompt: mocks.preparePrompt,
        generatePrepared: mocks.generatePrepared,
        requestTimeoutMs: () => 180_000
      }) as unknown as ReturnType<ProjectCommandDependencies['getParticipantIntakeClassifier']>
  };
});

describe('createProject', () => {
  it('records its creation profile and bundles a Svelte starter with a valid seed', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { createProject } = await import('./service');
    const template = getProjectTemplate('linear-search');

    const created = await createProject(
      { creation: { templateId: template.id } },
      serviceDependencies
    );
    const snapshot = projectSnapshotAt(created);

    expect(created.events[0]).toMatchObject({
      type: 'project.created',
      payload: {
        title: template.title,
        assistantId: 'sverlin-assistant',
        creation: { templateId: template.id }
      }
    });
    expect(snapshot.assistantId).toBe('sverlin-assistant');
    expect(snapshot.creation).toEqual({ templateId: template.id });
    expect(snapshot.artifacts[snapshot.entryArtifactId]).toMatchObject({
      path: 'Main.svelte',
      language: 'svelte'
    });
    expect(created.events.some(({ type }) => type === 'assistant.responded')).toBe(false);
    const presentation = created.events.find((event) => event.type === 'visualization.presented');
    if (
      presentation?.type !== 'visualization.presented' ||
      presentation.payload.presentation.format !== 'browser-bundle-v1'
    )
      throw new Error('Expected a browser bundle.');
    const seed = presentation.payload.presentation.seed;
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
  });

  it('records a view failure the browser reports once, for the assistant to read', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { createProject, reportRuntimeFailure } = await import('./service');
    const { projectConversationMessages } = await import('$lib/server/chat-bots/project-context');
    const created = await createProject(
      { creation: { templateId: getProjectTemplate('linear-search').id } },
      serviceDependencies
    );
    const presented = created.events.find((event) => event.type === 'visualization.presented');
    if (presented?.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    const presentationId = presented.payload.presentation.presentationId;
    const failure = {
      projectId: created.projectId,
      presentationId,
      step: 2,
      message: "Cannot read properties of null (reading 'missing')"
    };
    // Reported during a study phase, whose deadline the repair must keep.
    const deadlineAt = '2026-08-30T12:15:00.000Z';
    const first = await reportRuntimeFailure(
      {
        ...failure,
        expectedHead: projectHead(created).id,
        operationId: crypto.randomUUID(),
        deadlineAt
      },
      serviceDependencies
    );
    const recorded = first.document.events.filter(
      (event) => event.type === 'visualization.runtime-failed'
    );
    expect(recorded).toMatchObject([
      { actor: { kind: 'system' }, payload: { presentationId, step: 2, message: failure.message } }
    ]);
    // The same failure again adds nothing.
    const again = await reportRuntimeFailure(
      {
        ...failure,
        expectedHead: projectHead(first.document).id,
        operationId: crypto.randomUUID()
      },
      serviceDependencies
    );
    expect(again.document.events).toHaveLength(first.document.events.length);
    // The failure queues one repair of the current source; another failure of it queues none.
    const requests = (document: ProjectDocument) =>
      document.events.filter((event) => event.type === 'assistant.turn-requested');
    expect(requests(first.document)).toMatchObject([
      { payload: { interactionEventId: recorded[0].id, presentationCount: 1, deadlineAt } }
    ]);
    const other = await reportRuntimeFailure(
      {
        ...failure,
        message: 'Another failure',
        expectedHead: projectHead(first.document).id,
        operationId: crypto.randomUUID()
      },
      serviceDependencies
    );
    expect(other.document.events.at(-1)?.type).toBe('visualization.runtime-failed');
    expect(requests(other.document)).toHaveLength(1);
    // The assistant reads it as an automatic report, not as the participant's words.
    expect(projectConversationMessages(first.document.events).at(-1)).toEqual({
      role: 'user',
      content: expect.stringMatching(
        /^\[Reported automatically by the participant’s browser, not written by the participant\] Presentation .* failed while drawing step 3: Cannot read properties of null/u
      )
    });
    await expect(
      reportRuntimeFailure(
        {
          ...failure,
          presentationId: '00000000-0000-4000-8000-000000000000',
          expectedHead: projectHead(other.document).id,
          operationId: crypto.randomUUID()
        },
        serviceDependencies
      )
    ).rejects.toThrow('Only a presented visualization');
  });

  it('records how a presentation loaded as one inert event, never during an operation', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { createProject, recordPresentationLoad } = await import('./service');
    const { projectAiContext, projectConversationMessages } =
      await import('$lib/server/chat-bots/project-context');
    const created = await createProject(
      { creation: { templateId: getProjectTemplate('linear-search').id } },
      serviceDependencies
    );
    const presented = created.events.find((event) => event.type === 'visualization.presented');
    if (presented?.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    const report = {
      presentationId: presented.payload.presentation.presentationId,
      outcome: 'ready' as const,
      sinceLoadMs: 84,
      layout: 'server' as const,
      measuringMs: 0,
      recordingMs: 3,
      showingMs: 20,
      passes: 1,
      mostChanges: 0,
      visibility: 'visible' as const,
      devicePixelRatio: 2,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/142.0.0.0 Safari/537.36',
      fonts: { version: 'v1', loaded: true, sample: 'Hamburgefonstiv', widths: { 'A 400 16': 9 } }
    };

    const recorded = await recordPresentationLoad(
      { projectId: created.projectId, report },
      serviceDependencies
    );

    expect(recorded.events.slice(created.events.length)).toMatchObject([
      { type: 'visualization.loaded', actor: { kind: 'system' }, payload: report }
    ]);
    expect(projectSnapshotAt(recorded)).toEqual({
      ...projectSnapshotAt(created),
      at: recorded.events.length
    });
    // The assistant never sees it.
    expect(projectConversationMessages(recorded.events)).toEqual(
      projectConversationMessages(created.events)
    );
    expect(projectAiContext(recorded).timeline.map(({ type }) => type)).not.toContain(
      'visualization.loaded'
    );
    // While an operation runs it would move that operation's head, so it is refused.
    const running = await serviceDependencies.repository.append(
      created.projectId,
      recorded.events.length,
      [
        {
          type: 'operation.accepted',
          actor: { kind: 'user' },
          operationId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          payload: { kind: 'rename' }
        }
      ]
    );
    await expect(
      recordPresentationLoad({ projectId: created.projectId, report }, serviceDependencies)
    ).rejects.toMatchObject({ name: 'ProjectConflictError' });
    expect((await serviceDependencies.repository.load(created.projectId)).events).toHaveLength(
      running.document.events.length
    );
  });

  it('shows a variant that fails as before, asking the assistant for no repair', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { buildProjectPresentations, createProject, reportRuntimeFailure } =
      await import('./service');
    const { presentationBufferState } = await import('$lib/shared/projects/presentation-buffer');
    const { projectConversationMessages } = await import('$lib/server/chat-bots/project-context');
    const created = await createProject(
      { creation: { templateId: getProjectTemplate('linear-search').id } },
      serviceDependencies
    );
    const starter = created.events.find((event) => event.type === 'visualization.presented');
    if (starter?.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    // A pair of new variants, each drawn at random from the starter's values.
    const pair = await buildProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        operationId: crypto.randomUUID(),
        from: starter.payload.presentation.presentationId,
        presentationCount: 2
      },
      serviceDependencies
    );
    const shown = pair.appendedEvents.filter(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented'
    );
    expect(shown).toHaveLength(2);
    const [beside, failing] = shown.map(({ payload }) => payload.presentation);
    if (failing.format !== 'browser-bundle-v1' || beside.format !== 'browser-bundle-v1')
      throw new Error('Expected browser bundles.');

    const reported = await reportRuntimeFailure(
      {
        projectId: created.projectId,
        expectedHead: projectHead(pair.document).id,
        operationId: crypto.randomUUID(),
        presentationId: failing.presentationId,
        step: 0,
        message: 'l.view is not a function'
      },
      serviceDependencies
    );

    const appended = reported.appendedEvents.map(({ type }) => type);
    expect(appended[0]).toBe('visualization.runtime-failed');
    expect(appended).toContain('visualization.variant-reverted');
    expect(appended).not.toContain('assistant.turn-requested');
    const reverted = reported.appendedEvents.find(
      (event): event is ProjectEventOf<'visualization.variant-reverted'> =>
        event.type === 'visualization.variant-reverted'
    )!;
    expect(reverted.payload).toMatchObject({
      presentationId: failing.presentationId,
      presentations: [beside.presentationId, failing.presentationId]
    });
    expect(Object.keys(reverted.payload.values).length).toBeGreaterThan(0);
    // Built again from the starter's values, the one beside it as it was, as a new pair.
    const again = reported.appendedEvents.filter(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented'
    );
    expect(again.map(({ payload }) => payload.presentation.presentationId)).toEqual(
      reverted.payload.replacements
    );
    const [besideAgain, failingAgain] = again.map(({ payload }) => payload.presentation);
    if (failingAgain.format !== 'browser-bundle-v1' || besideAgain.format !== 'browser-bundle-v1')
      throw new Error('Expected browser bundles.');
    expect(besideAgain.variant).toEqual(beside.variant);
    expect(failingAgain.seed).toBe(failing.seed);
    const starterValues =
      starter.payload.presentation.format === 'browser-bundle-v1'
        ? starter.payload.presentation.variant
        : undefined;
    for (const [key, value] of Object.entries(reverted.payload.shown))
      if (!key.startsWith('pause@')) expect(value).toEqual(starterValues?.[key]);
    expect(reported.appendedEvents.find((event) => event.type === 'build.requested')).toMatchObject(
      { payload: { purpose: 'variant-fallback' } }
    );
    // The pair that failed is taken out; the new pair is what shows.
    const available = presentationBufferState(reported.document, 0).available.map(
      ({ presentationId }) => presentationId
    );
    expect(available).not.toContain(failing.presentationId);
    expect(available).not.toContain(beside.presentationId);
    expect(available).toEqual(expect.arrayContaining(reverted.payload.replacements));
    // The assistant is not asked to fix the source for it.
    expect(
      projectConversationMessages(reported.document.events).some((message) =>
        message.content.includes('l.view is not a function')
      )
    ).toBe(false);
  });

  it('asks for a repair when what the source draws as it was made fails', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { createProject, reportRuntimeFailure } = await import('./service');
    const created = await createProject(
      { creation: { templateId: getProjectTemplate('linear-search').id } },
      serviceDependencies
    );
    const starter = created.events.find((event) => event.type === 'visualization.presented');
    if (starter?.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    const reported = await reportRuntimeFailure(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        operationId: crypto.randomUUID(),
        presentationId: starter.payload.presentation.presentationId,
        message: 't.before is not a function'
      },
      serviceDependencies
    );
    expect(reported.appendedEvents.map(({ type }) => type)).toEqual([
      'visualization.runtime-failed',
      'assistant.turn-requested'
    ]);
  });

  it('adds the selected assistant introduction to blank projects without a model request', async () => {
    const { createProject } = await import('./service');

    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );

    expect(created.events[0]).toMatchObject({
      type: 'project.created',
      payload: { assistantId: 'html-assistant' }
    });
    expect(created.events[2]).toMatchObject({
      type: 'assistant.responded',
      actor: { kind: 'assistant', botId: 'html-assistant' },
      payload: { content: markdownMessage('Tell me what you would like to visualize.') }
    });
    expect(mocks.generatePrepared).not.toHaveBeenCalled();
  });
});

describe('participant intake', () => {
  it('authors from the answer to its one question, without classifying it', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Intake' }, serviceDependencies);
    const document = await withActiveIntake(created, 'algorithm');
    mocks.preparePrompt.mockImplementation(async () => generationPrompt('initial'));
    mocks.generatePrepared.mockResolvedValue(
      generation('valid intake source', 'Here is linear search.')
    );

    const result = await submitProjectFeedback(
      feedbackOptions(document, 'Bubble sort', '12345678-1234-4123-8123-123456789a01'),
      commandDependencies
    );

    expect(result.appendedEvents).toContainEqual(
      expect.objectContaining({
        type: 'assistant.intake-completed',
        payload: expect.objectContaining({ outcome: 'answered' })
      })
    );
    expect(
      result.appendedEvents.filter(
        (event) => event.type === 'ai.generation-requested' && event.payload.purpose === 'intake'
      )
    ).toEqual([]);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(1);
  });
});

describe('presentation buffer refill', () => {
  it('does not build the untouched blank-project source', async () => {
    const { createProject, replenishProjectPresentations } = await import('./service');
    const created = await createProject(
      { title: 'Untouched blank', creation: { templateId: 'blank' } },
      serviceDependencies
    );

    const unchanged = await replenishProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        target: 4,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      serviceDependencies
    );

    expect(unchanged.appendedEvents).toEqual([]);
  });

  it('fills the exact current-source deficit and becomes idempotent at the target', async () => {
    const { createProject, replenishProjectPresentations } = await import('./service');
    const created = await createProject(
      {
        title: 'Buffered comparison',
        creation: { templateId: 'linear-search' },
        presentationCount: 2
      },
      serviceDependencies
    );

    const filled = await replenishProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        target: 4,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      serviceDependencies
    );

    expect(
      filled.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(2);
    const unchanged = await replenishProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(filled.document).id,
        target: 4,
        operationId: '22345678-1234-4234-8234-123456789abc'
      },
      serviceDependencies
    );
    expect(unchanged.appendedEvents).toEqual([]);
  });
});

describe('submitProjectFeedback', () => {
  it('durably queues Sverlin feedback without making a model request', async () => {
    const { createProject } = await import('./service');
    const { queueProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Queued feedback' }, serviceDependencies);
    const operationId = '12345678-1234-4123-8123-123456789abc';
    const accepted = await serviceDependencies.repository.append(
      created.projectId,
      projectHead(created).id,
      [
        {
          type: 'operation.accepted',
          actor: { kind: 'user' },
          operationId,
          createdAt: '2026-08-30T12:00:00.000Z',
          payload: { kind: 'feedback' }
        }
      ]
    );

    const result = await queueProjectFeedback(
      {
        projectId: created.projectId,
        operationId,
        content: markdownMessage('Move the label.'),
        focus: [],
        presentationCount: 2,
        deadlineAt: '2026-08-30T12:05:00.000Z'
      },
      commandDependencies
    );

    expect(result.appendedEvents.map(({ type }) => type)).toEqual([
      'feedback.submitted',
      'assistant.turn-requested'
    ]);
    expect(result.appendedEvents[0]).toMatchObject({
      payload: { presentationCount: 2 }
    });
    expect(result.appendedEvents[1]).toMatchObject({
      payload: {
        interactionEventId: projectHead(accepted.document).id + 1,
        presentationCount: 2,
        deadlineAt: '2026-08-30T12:05:00.000Z'
      }
    });
    expect(mocks.generatePrepared).not.toHaveBeenCalled();
  });

  it('records what was on screen beside the message, not in it', async () => {
    const { createProject } = await import('./service');
    const { queueProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Viewed', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    const [shown] = created.events.flatMap((event) =>
      event.type === 'visualization.presented' ? [event.payload.presentation] : []
    );
    const queue = async (operationId: string, viewing: FeedbackViewing) => {
      const before = await serviceDependencies.repository.load(created.projectId);
      await serviceDependencies.repository.append(created.projectId, projectHead(before).id, [
        {
          type: 'operation.accepted',
          actor: { kind: 'user' },
          operationId,
          createdAt: '2026-08-30T12:00:00.000Z',
          payload: { kind: 'feedback' }
        }
      ]);
      const result = await queueProjectFeedback(
        {
          projectId: created.projectId,
          operationId,
          content: markdownMessage('Lecture'),
          focus: [],
          presentationCount: 2,
          viewing
        },
        commandDependencies
      );
      return result.appendedEvents[0];
    };

    // The step is named as the presentation names it, not as the browser said.
    const stepName = presentationStepName(shown, 1);
    expect(
      await queue('12345678-1234-4123-8123-123456789abc', {
        presentations: [{ presentationId: shown.presentationId, step: 1, stepName: '@made.up#1' }]
      })
    ).toMatchObject({
      type: 'feedback.submitted',
      payload: {
        content: markdownMessage('Lecture'),
        viewing: {
          presentations: [
            { presentationId: shown.presentationId, step: 1, ...(stepName ? { stepName } : {}) }
          ]
        }
      }
    });
    expect(await queue('12345678-1234-4123-8123-123456789abd', { source: 'abc123' })).toMatchObject(
      { payload: { viewing: { source: 'abc123' } } }
    );
  });

  it('processes a claimed interaction and correlates the early assistant observation', async () => {
    const { createProject } = await import('./service');
    const { runQueuedAssistantTurn } = await import('./commands');
    const created = await createProject({ title: 'Claimed feedback' }, serviceDependencies);
    const feedbackOperationId = '12345678-1234-4123-8123-123456789abc';
    const assistantOperationId = '12345678-1234-4123-8123-123456789abd';
    const head = projectHead(created).id;
    const queued = await serviceDependencies.repository.append(created.projectId, head, [
      {
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        operationId: feedbackOperationId,
        createdAt: '2026-08-30T12:00:00.000Z',
        payload: {
          content: markdownMessage('Explain the current layout.'),
          focus: [],
          presentationCount: 2
        }
      },
      {
        type: 'assistant.turn-requested',
        actor: { kind: 'system' },
        operationId: feedbackOperationId,
        createdAt: '2026-08-30T12:00:01.000Z',
        payload: { interactionEventId: head + 1, presentationCount: 2 }
      },
      {
        type: 'operation.accepted',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:02.000Z',
        payload: { kind: 'assistant-turn' }
      },
      {
        type: 'assistant.turn-started',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:03.000Z',
        payload: { requestEventIds: [head + 2], interactionEventIds: [head + 1] }
      }
    ]);
    mocks.generatePrepared.mockReset().mockResolvedValue(generation(undefined, 'I am looking.'));

    const result = await runQueuedAssistantTurn(
      { projectId: created.projectId, operationId: assistantOperationId },
      commandDependencies
    );

    expect(result.appendedEvents.map(({ type }) => type)).toEqual([
      'ai.generation-requested',
      'ai.generation-succeeded',
      'assistant.responded'
    ]);
    expect(result.appendedEvents.at(-1)).toMatchObject({
      payload: {
        content: markdownMessage('I am looking.'),
        inReplyTo: [head + 1]
      }
    });
    expect(projectHead(queued.document).id).toBe(head + 4);
  });

  it('repairs a view failure the browser reports without the participant asking', async () => {
    const { getProjectTemplate } = await import('./starter-catalog');
    const { createProject, reportRuntimeFailure } = await import('./service');
    const { runQueuedAssistantTurn } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: getProjectTemplate('linear-search').id } },
      serviceDependencies
    );
    const presented = created.events.find((event) => event.type === 'visualization.presented');
    if (presented?.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    const presentationId = presented.payload.presentation.presentationId;
    const reported = await reportRuntimeFailure(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        operationId: crypto.randomUUID(),
        presentationId,
        message: 't.before is not a function'
      },
      serviceDependencies
    );
    const [failure, request] = reported.document.events.slice(-2);
    const assistantOperationId = crypto.randomUUID();
    await serviceDependencies.repository.append(created.projectId, request.id, [
      {
        type: 'operation.accepted',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:02.000Z',
        payload: { kind: 'assistant-turn' }
      },
      {
        type: 'assistant.turn-started',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:03.000Z',
        payload: { requestEventIds: [request.id], interactionEventIds: [failure.id] }
      }
    ]);
    mocks.generatePrepared.mockReset().mockResolvedValue(generation(undefined, 'Fixed step 5.'));

    const result = await runQueuedAssistantTurn(
      { projectId: created.projectId, operationId: assistantOperationId },
      commandDependencies
    );

    const { project } = mocks.preparePrompt.mock.calls[0][0];
    expect(project.interaction).toEqual({ kind: 'runtime-failure', eventId: failure.id });
    expect(project.selected.presentations).toMatchObject([{ presentationId }]);
    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: { content: markdownMessage('Fixed step 5.'), inReplyTo: [failure.id] }
    });
  });

  it('processes queued HTML feedback through its own assistant after intake', async () => {
    const { createProject } = await import('./service');
    const { runQueuedAssistantTurn } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );
    const feedbackOperationId = crypto.randomUUID();
    const assistantOperationId = crypto.randomUUID();
    const withQuestion = await serviceDependencies.repository.append(
      created.projectId,
      projectHead(created).id,
      [
        {
          type: 'assistant.responded',
          actor: { kind: 'assistant', botId: 'html-assistant' },
          operationId: feedbackOperationId,
          createdAt: new Date().toISOString(),
          payload: { content: markdownMessage('Which algorithm?'), intakeStep: 'algorithm' }
        }
      ]
    );
    const head = projectHead(withQuestion.document).id;
    await serviceDependencies.repository.append(created.projectId, head, [
      {
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        operationId: feedbackOperationId,
        createdAt: new Date().toISOString(),
        payload: { content: markdownMessage('Show a comparison'), focus: [], presentationCount: 1 }
      },
      {
        type: 'assistant.turn-requested',
        actor: { kind: 'system' },
        operationId: feedbackOperationId,
        createdAt: new Date().toISOString(),
        payload: { interactionEventId: head + 1, presentationCount: 1 }
      },
      {
        type: 'operation.accepted',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: new Date().toISOString(),
        payload: { kind: 'assistant-turn' }
      },
      {
        type: 'assistant.turn-started',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: new Date().toISOString(),
        payload: { requestEventIds: [head + 2], interactionEventIds: [head + 1] }
      }
    ]);
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(htmlGeneration(manifest('<main><h1>Done</h1></main>'), 'Created it'));
    const result = await runQueuedAssistantTurn(
      { projectId: created.projectId, operationId: assistantOperationId },
      commandDependencies
    );
    expect(result.appendedEvents.map(({ type }) => type)).toContain('visualization.presented');
    expect(result.appendedEvents.some((event) => event.type === 'assistant.intake-completed')).toBe(
      true
    );
    expect(
      result.appendedEvents.find((event) => event.type === 'visualization.presented')
    ).toMatchObject({ payload: { presentation: { format: 'html-frames-v1' } } });
  });

  it('generates the first candidate pair from accepted blank-project source on request', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('I am preparing two more options.'),
      decision: { action: 'resample' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'First candidates' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Show the accepted source'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const presented = result.appendedEvents.filter(
      (event) => event.type === 'visualization.presented'
    );
    expect(presented).toHaveLength(2);
    expect(
      result.appendedEvents.some((event) => event.type === 'visualization.candidates-advanced')
    ).toBe(false);
    expect(result.appendedEvents.find(({ type }) => type === 'assistant.responded')).toMatchObject({
      type: 'assistant.responded',
      payload: {
        content: markdownMessage('I am preparing two more options.')
      }
    });
  });

  it('keeps the visible candidate until a complete resampled pair is ready', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('I am preparing another pair.'),
      decision: { action: 'resample' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Pinned resample', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Generate more visualizations.'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const firstReplacement = result.appendedEvents.findIndex(
      ({ type }) => type === 'visualization.presented'
    );
    const consumed = result.appendedEvents.findIndex(
      ({ type }) => type === 'visualization.candidates-advanced'
    );
    expect(firstReplacement).toBeGreaterThanOrEqual(0);
    expect(consumed).toBeGreaterThan(firstReplacement);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(2);
  });

  it('builds a first attempt that gave a recovery explanation, not showing it', async () => {
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(
        generation('valid source', 'Ready', { struggledWith: 'nothing', simplified: 'nothing' })
      );
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Recovery' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Show it'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(1);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(1);
    expect(JSON.stringify(result.appendedEvents)).not.toContain('struggledWith');
  });

  it('presents one version of a new source where the stage shows two', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue(generation('valid source', 'Ready'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'One version' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Show linear search'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const buildRequests = result.appendedEvents.filter((event) => event.type === 'build.requested');
    const buildResults = result.appendedEvents.filter((event) => event.type === 'build.succeeded');
    expect(buildRequests).toHaveLength(1);
    expect(buildResults).toHaveLength(1);
    expect(buildResults[0].payload.buildId).toBe(buildRequests[0].payload.buildId);
    expect(buildResults[0].payload.bundle.mediaType).toBe('application/json');
    expect(
      result.appendedEvents.filter((event) => event.type === 'visualization.presented')
    ).toHaveLength(1);
  });

  it('asks no chooser for a new source: its first build stands, with the starter’s values for what is new', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue(generation('valid source', 'Ready'));
    const choose = vi.fn();
    const chooserDependencies: ProjectCommandDependencies = {
      ...commandDependencies,
      chooserFor: async () => 'model',
      getChooser: () =>
        ({
          preparePrompt: async () => ({}),
          generatePrepared: choose,
          requestTimeoutMs: () => 180_000
        }) as unknown as ReturnType<NonNullable<ProjectCommandDependencies['getChooser']>>
    };
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Unchosen' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Show one'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      chooserDependencies
    );

    expect(choose).not.toHaveBeenCalled();
    expect(
      result.appendedEvents.some(
        (event) => event.type === 'ai.generation-requested' && event.payload.purpose === 'choosing'
      )
    ).toBe(false);
    expect(result.appendedEvents.filter((event) => event.type === 'build.requested')).toHaveLength(
      1
    );
    const [shown] = result.appendedEvents.flatMap((event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1'
        ? [event.payload.presentation]
        : []
    );
    expect(new Set(Object.values(shown.origins ?? {}))).toEqual(new Set(['starter']));
  });

  describe('Another variant', () => {
    const chooserWith = (generatePrepared: ReturnType<typeof vi.fn>) =>
      ({
        preparePrompt: async (request: { project: unknown }) => ({
          initialPrompt: 'Choose',
          messages: [],
          context: { project: request.project },
          attempt: { number: 1, purpose: 'choosing' },
          parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
          responseFormat: { name: 'design_variants', schema: {} }
        }),
        generatePrepared,
        requestTimeoutMs: () => 180_000
      }) as unknown as ReturnType<NonNullable<ProjectCommandDependencies['getChooser']>>;

    /** A project whose source has been shown once, without a chooser. */
    async function shownProject() {
      mocks.generatePrepared.mockReset().mockResolvedValue(generation('valid source', 'Ready'));
      const { createProject } = await import('./service');
      const { submitProjectFeedback } = await import('./commands');
      const created = await createProject({ title: 'Resampled' }, serviceDependencies);
      const result = await submitProjectFeedback(
        {
          projectId: created.projectId,
          expectedHead: projectHead(created).id,
          content: markdownMessage('Show one'),
          focus: [],
          presentationCount: 1,
          operationId: '12345678-1234-4123-8123-123456789abc'
        },
        commandDependencies
      );
      const presented = result.document.events.findLast(
        (event) => event.type === 'visualization.presented'
      ) as ProjectEventOf<'visualization.presented'>;
      return { document: result.document, from: presented.payload.presentation.presentationId };
    }

    async function resample(
      dependencies: ProjectCommandDependencies,
      picked?: 'model' | 'decisions' | 'random'
    ) {
      const { document, from } = await shownProject();
      const { buildProjectPresentations } = await import('./service');
      const { chosenVariantRequests } = await import('./commands');
      const result = await buildProjectPresentations(
        {
          projectId: document.projectId,
          expectedHead: projectHead(document).id,
          operationId: '22345678-1234-4123-8123-123456789abc',
          presentationCount: 2,
          from,
          requestVariants: chosenVariantRequests(dependencies, picked)
        },
        serviceDependencies
      );
      const shown = result.appendedEvents.flatMap((event) =>
        event.type === 'visualization.presented' &&
        event.payload.presentation.format === 'browser-bundle-v1'
          ? [event.payload.presentation]
          : []
      );
      return { result, shown };
    }

    it('asks the chooser, as a resample, and shows what it picks', async () => {
      const choose = vi.fn(async (prompt: { context: { project: Record<string, unknown> } }) => ({
        variants: [
          { values: [{ variable: 'Shown.fill', value: 'amber-100' }], randomise: [] },
          { values: [{ variable: 'Shown.fill', value: 'blue-100' }], randomise: [] }
        ],
        prompt,
        generation: { botId: 'sverlin-chooser', adapterId: 'test-adapter', model: 'test-model' }
      }));
      const { shown } = await resample({
        ...commandDependencies,
        getChooser: () => chooserWith(choose),
        chooserFor: async () => 'model'
      });

      expect(choose).toHaveBeenCalledOnce();
      expect(shown.map(({ variant }) => variant?.['Shown.fill'])).toEqual([
        'amber-100',
        'blue-100'
      ]);
    });

    it('draws at random when the chooser fails', async () => {
      const { result, shown } = await resample({
        ...commandDependencies,
        getChooser: () => chooserWith(vi.fn().mockRejectedValue(new Error('Unavailable.'))),
        chooserFor: async () => 'model'
      });

      expect(result.appendedEvents.some((event) => event.type === 'ai.generation-failed')).toBe(
        true
      );
      expect(result.appendedEvents.some((event) => event.type === 'system.notified')).toBe(false);
      expect(shown).toHaveLength(2);
    });

    it('draws at random when the chooser is past its time limit', async () => {
      const hang = vi.fn(
        (_prompt: unknown, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
          )
      );
      const { result, shown } = await resample({
        ...commandDependencies,
        getChooser: () => chooserWith(hang),
        chooserFor: async () => 'model',
        resampleTimeLimitMs: 50
      });

      expect(result.appendedEvents.some((event) => event.type === 'ai.generation-failed')).toBe(
        true
      );
      expect(shown).toHaveLength(2);
    });

    it('uses the chooser picked in dev mode over the configured one', async () => {
      const choose = vi.fn();
      const { shown } = await resample(
        {
          ...commandDependencies,
          getChooser: () => chooserWith(choose),
          chooserFor: async () => 'model'
        },
        'random'
      );

      expect(choose).not.toHaveBeenCalled();
      expect(shown).toHaveLength(2);
    });

    it('asks no bot when the random draw is configured', async () => {
      const choose = vi.fn();
      const { shown } = await resample({
        ...commandDependencies,
        getChooser: () => chooserWith(choose),
        chooserFor: async () => 'random'
      });

      expect(choose).not.toHaveBeenCalled();
      expect(shown).toHaveLength(2);
    });
  });

  it('repairs a failed component batch using the same seed', async () => {
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce(generation('broken first source', 'First'))
      .mockResolvedValueOnce(generation('repaired source', 'Repaired'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Partial batch' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Refine this'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const requests = result.appendedEvents.filter((event) => event.type === 'build.requested');
    expect(requests).toHaveLength(2);
    expect(requests[0].payload.seed).toBe(requests[1].payload.seed);
    expect(
      result.appendedEvents.filter((event) => event.type === 'visualization.presented')
    ).toHaveLength(1);
  });

  it('uses the fifth attempt for a simpler working fallback and explains it', async () => {
    mocks.generatePrepared.mockReset().mockImplementation(async (prompt) =>
      prompt.attempt.purpose === 'fallback'
        ? generation('valid simplified source', 'Here is the working version.', {
            struggledWith: 'combining every requested animation',
            simplified: 'the animation sequence while preserving the algorithm'
          })
        : generation(`broken attempt ${prompt.attempt.number}`, 'Trying the full design')
    );
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Graceful fallback' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Make an elaborate animated visualization'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const requests = result.appendedEvents.filter(
      (event) => event.type === 'ai.generation-requested'
    );
    expect(requests.map(({ payload }) => payload.purpose)).toEqual([
      'initial',
      'repair',
      'repair',
      'repair',
      'fallback'
    ]);
    expect(requests.map(({ payload }) => payload.parameters.reasoningEffort)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'xhigh'
    ]);
    expect(mocks.preparePrompt.mock.calls[4][0].buildFeedback).toMatchObject({
      attempt: 4,
      priorFailureSummaries: expect.arrayContaining([
        expect.stringContaining('Attempt 1'),
        expect.stringContaining('Attempt 4')
      ])
    });
    const buildRequests = result.appendedEvents.filter((event) => event.type === 'build.requested');
    expect(new Set(buildRequests.map(({ payload }) => payload.seed)).size).toBe(1);
    // Only the accepted attempt's reply is recorded, after what it presents.
    const replies = result.appendedEvents.filter(({ type }) => type === 'assistant.responded');
    expect(replies).toHaveLength(1);
    expect(result.appendedEvents.indexOf(replies[0])).toBeGreaterThan(
      result.appendedEvents.findIndex(({ type }) => type === 'visualization.presented')
    );
    expect(replies[0]).toMatchObject({
      type: 'assistant.responded',
      payload: {
        content: [
          expect.objectContaining({
            type: 'markdown',
            text: expect.stringContaining('combining every requested animation')
          }),
          { type: 'markdown', text: 'Here is the working version.' }
        ]
      }
    });
    expect(result.appendedEvents.some(({ type }) => type === 'artifact.version-created')).toBe(
      true
    );
  });

  describe('a repair ladder', () => {
    // Sources sharing most lines, each failing with a problem of its own, or building.
    const lines = (close: string, snippet = '', node = '') =>
      [
        '<script algorithm></script>',
        '{#snippet Shown()}<Node>one</Node>{/snippet}',
        snippet,
        '<Layout name="Main"><Node>',
        '<Node>{@render Shown()}</Node>',
        '<Node>two</Node>',
        '<Node>three</Node>',
        node,
        `</Node>${close}`
      ].join('\n');
    const sources = {
      unclosed: lines('</Layout'),
      twice: lines('</Layout>', '{#snippet Shown()}<Node>again</Node>{/snippet}'),
      unknown: lines('</Layout>', '', '<Node>{@render Missing()}</Node>'),
      rewritten:
        '<script algorithm></script>\n<Layout name="Main">\n<Node>{@render Gone()}</Node>\n</Layout>',
      working: lines('</Layout>')
    };
    // Each explains a difficulty, as the simpler fallback must; the others' are dropped.
    const attempts = (...names: (keyof typeof sources)[]) => {
      mocks.generatePrepared.mockReset();
      for (const name of names)
        mocks.generatePrepared.mockResolvedValueOnce({
          ...generation('unused', `Source ${name}`, { struggledWith: 'it', simplified: 'it' }),
          decision: { action: 'revise', source: sources[name], summary: `Source ${name}` }
        });
    };
    // The ladder's sources go after a working first version, unless the project is still blank.
    const submit = async (...names: (keyof typeof sources)[]) => submitTo(true, names);
    const submitBlank = async (...names: (keyof typeof sources)[]) => submitTo(false, names);
    const submitTo = async (withVersion: boolean, names: (keyof typeof sources)[]) => {
      const { createProject } = await import('./service');
      const { submitProjectFeedback } = await import('./commands');
      let document: ProjectDocument = await createProject(
        { title: 'Repair ladder' },
        serviceDependencies
      );
      if (withVersion) {
        mocks.generatePrepared.mockReset().mockResolvedValueOnce(generation('first', 'First'));
        const first = await submitProjectFeedback(
          {
            ...feedbackOptions(document, 'Draw it', '12345678-1234-4123-8123-123456789abb'),
            presentationCount: 1
          },
          commandDependencies
        );
        document = first.document;
      }
      attempts(...names);
      return submitProjectFeedback(
        {
          projectId: document.projectId,
          expectedHead: projectHead(document).id,
          content: markdownMessage('Do the edge case too'),
          focus: [],
          presentationCount: 1,
          operationId: '12345678-1234-4123-8123-123456789abc'
        },
        commandDependencies
      );
    };
    const failures = (events: ProjectEvent[]) =>
      events.flatMap((event) =>
        event.type === 'build.failed'
          ? [(event.payload.diagnostics ?? []).map(({ code, message }) => `${code}: ${message}`)]
          : []
      );
    const stopped = (events: ProjectEvent[]) => {
      expect(events.at(-1)).toMatchObject({
        type: 'system.notified',
        payload: { severity: 'error', message: expect.stringContaining('each repair ran into') }
      });
      expect(events.some(({ type }) => type === 'artifact.version-created')).toBe(false);
    };

    it('stops once two repairs fail with problems unrelated to those they repaired', async () => {
      const result = await submit('unclosed', 'twice', 'unknown', 'working');
      const failed = failures(result.appendedEvents);
      expect(failed).toHaveLength(3);
      expect(new Set(failed.flat()).size).toBe(failed.flat().length);
      expect(mocks.generatePrepared).toHaveBeenCalledTimes(3);
      stopped(result.appendedEvents);
    });

    it('stops at once after a repair that rewrote the source and failed differently', async () => {
      const result = await submit('unclosed', 'rewritten', 'working');
      expect(failures(result.appendedEvents)).toHaveLength(2);
      expect(mocks.generatePrepared).toHaveBeenCalledTimes(2);
      stopped(result.appendedEvents);
      expect(result.appendedEvents.at(-1)).toMatchObject({
        payload: { message: expect.stringContaining('kept the last working visualization') }
      });
    });

    it('goes to the simpler fallback, not stopping, when there is no first version to keep', async () => {
      const result = await submitBlank('unclosed', 'rewritten', 'working');
      expect(failures(result.appendedEvents)).toHaveLength(2);
      expect(mocks.generatePrepared).toHaveBeenCalledTimes(3);
      expect(mocks.preparePrompt.mock.calls.map(([options]) => options.attempt)).toEqual([1, 2, 5]);
      expect(result.appendedEvents.some(({ type }) => type === 'artifact.version-created')).toBe(
        true
      );
    });

    it('never says a version was kept when the fallback fails on a blank project', async () => {
      const result = await submitBlank('unclosed', 'rewritten', 'unknown');
      expect(mocks.generatePrepared).toHaveBeenCalledTimes(3);
      const last = result.appendedEvents.at(-1);
      expect(last?.type).toBe('system.notified');
      expect(JSON.stringify(last?.payload)).not.toContain('kept');
    });

    it('takes a problem whose message lists what exists, as the list changes, as the same', async () => {
      const { repairWandered } = await import('./commands');
      const missing = (kinds: string) => ({
        source: '',
        diagnostics: [
          {
            code: 'design_value',
            message: `The design has no variable Found.size; its kinds of node are ${kinds}.`
          }
        ]
      });
      expect(repairWandered(missing('Cell, Label'), missing('Cell, Marker, Label'))).toBe(false);
      const other = { source: '', diagnostics: [{ code: 'view_layout', message: 'Unclosed.' }] };
      expect(repairWandered(missing('Cell'), other)).toBe(true);
    });

    it('keeps repairing one stuck on a problem, or revealing one new one, to success', async () => {
      const result = await submit('unclosed', 'unclosed', 'twice', 'working');
      expect(failures(result.appendedEvents)).toHaveLength(3);
      expect(mocks.generatePrepared).toHaveBeenCalledTimes(4);
      expect(result.appendedEvents.some(({ type }) => type === 'artifact.version-created')).toBe(
        true
      );
      expect(result.appendedEvents.some(({ type }) => type === 'system.notified')).toBe(false);
    });
  });

  it('records a focused preference and defers source revision with a brief observation', async () => {
    const { submitProjectPreference } = await import('./commands');
    const comparison = await createComparisonProject('Preference observation');
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(generation(undefined, 'The preference suggests clearer spacing.'));

    const result = await submitProjectPreference(
      {
        projectId: comparison.document.projectId,
        expectedHead: projectHead(comparison.document).id,
        presentations: comparison.presentations.map(
          ({ payload }) => payload.presentation.presentationId
        ) as [string, string],
        answer: { preferred: comparison.presentations[0].payload.presentation.presentationId },
        step: 0,
        operationId: '12345678-1234-4123-8123-123456789abd'
      },
      commandDependencies
    );

    expect(result.appendedEvents[0]).toMatchObject({
      type: 'visualization.preference-recorded',
      payload: {
        preferred: comparison.presentations[0].payload.presentation.presentationId,
        step: 0
      }
    });
    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: { content: markdownMessage('The preference suggests clearer spacing.') }
    });
    expect(result.appendedEvents.some(({ type }) => type === 'artifact.version-created')).toBe(
      false
    );
    expect(mocks.preparePrompt.mock.calls.at(-1)?.[0].project).toMatchObject({
      interaction: {
        kind: 'preference',
        preferredPresentationId: comparison.presentations[0].payload.presentation.presentationId,
        alternativePresentationId: comparison.presentations[1].payload.presentation.presentationId,
        step: 0
      },
      selected: {
        presentations: [
          { eventId: comparison.presentations[0].id },
          { eventId: comparison.presentations[1].id }
        ]
      }
    });
  });

  it('proactively builds a revised version when preference evidence is sufficient', async () => {
    const { submitProjectPreference } = await import('./commands');
    const comparison = await createComparisonProject('Preference adaptation');
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(generation('valid adapted source', 'I adapted the spacing.'));

    const result = await submitProjectPreference(
      {
        projectId: comparison.document.projectId,
        expectedHead: projectHead(comparison.document).id,
        presentations: comparison.presentations.map(
          ({ payload }) => payload.presentation.presentationId
        ) as [string, string],
        answer: { preferred: comparison.presentations[1].payload.presentation.presentationId },
        step: 0,
        operationId: '12345678-1234-4123-8123-123456789abe'
      },
      commandDependencies
    );

    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(1);
    expect(result.appendedEvents).toContainEqual(
      expect.objectContaining({ type: 'artifact.version-created' })
    );
    const observationIndex = result.appendedEvents.findIndex(
      ({ type }) => type === 'assistant.responded'
    );
    const shownIndex = result.appendedEvents.findIndex(
      ({ type }) => type === 'visualization.presented'
    );
    expect(shownIndex).toBeGreaterThanOrEqual(0);
    expect(observationIndex).toBeGreaterThan(shownIndex);
    expect(result.appendedEvents[observationIndex]).toMatchObject({
      type: 'assistant.responded',
      payload: { content: markdownMessage('I adapted the spacing.') }
    });
  });

  it('accepts one safe HTML manifest and links it to its generation event', async () => {
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(htmlGeneration(manifest('<main><h1>Safe</h1></main>'), 'Created it'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Create an HTML visualization'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const generation = result.appendedEvents.find(
      (event) => event.type === 'ai.generation-succeeded'
    );
    const presented = result.appendedEvents.find(
      (event) => event.type === 'visualization.presented'
    );
    expect(presented).toMatchObject({
      type: 'visualization.presented',
      payload: { presentation: { format: 'html-frames-v1', generationEventId: generation?.id } }
    });
    expect(
      result.appendedEvents.filter(({ type }) => type === 'artifact.version-created')
    ).toHaveLength(1);
  });

  it('accepts a separate HTML/JS candidate through its dedicated assistant', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('Created an interactive visualization.'),
      candidates: [
        {
          label: 'Interactive',
          manifest: {
            format: 'html-js-v1',
            html: '<main onclick="unsafe()">Demo</main>',
            javascript: 'document.querySelector("main").textContent = "Ready";'
          }
        }
      ],
      prompt: {},
      generation: { botId: 'html-js-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html-js' } },
      serviceDependencies
    );
    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Make it interactive'),
        focus: [],
        presentationCount: 1,
        operationId: crypto.randomUUID()
      },
      commandDependencies
    );
    const presentation = result.appendedEvents.find(
      (event) => event.type === 'visualization.presented'
    );
    expect(presentation?.type).toBe('visualization.presented');
    if (
      presentation?.type !== 'visualization.presented' ||
      presentation.payload.presentation.format !== 'browser-bundle-v1'
    )
      throw new Error('Expected HTML/JS bundle.');
    expect(presentation.payload.presentation.mode).toBe('html-js');
    expect(presentation.payload.presentation.html.text).toBe('<main>Demo</main>');
    expect(projectSnapshotAt(result.document).artifacts.main.content.text).toContain('html-js-v1');
  });

  it('repairs an HTML/JS import violation without activating the rejected candidate', async () => {
    const reply = markdownMessage('Here is the corrected version.');
    const candidate = (javascript: string) => ({
      reply,
      candidates: [
        {
          label: 'Interactive',
          manifest: { format: 'html-js-v1', html: '<main>Safe</main>', javascript }
        }
      ],
      prompt: {},
      generation: { botId: 'html-js-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce(candidate('import(window.remote);'))
      .mockResolvedValueOnce(candidate('document.querySelector("main").textContent = "Ready";'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html-js' } },
      serviceDependencies
    );
    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Make it interactive'),
        focus: [],
        presentationCount: 1,
        operationId: crypto.randomUUID()
      },
      commandDependencies
    );
    expect(
      result.appendedEvents.filter(({ type }) => type === 'ai.generation-requested')
    ).toHaveLength(2);
    const presentations = result.appendedEvents.filter(
      (event) => event.type === 'visualization.presented'
    );
    expect(presentations).toHaveLength(1);
    expect(
      presentations[0].payload.presentation.format === 'browser-bundle-v1' &&
        presentations[0].payload.presentation.javascript.text
    ).toContain('Ready');
    expect(mocks.preparePrompt.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('cannot import') })
      ])
    );
  });

  it('keeps a conversational HTML reply without forcing a visualization change', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue(htmlGeneration(undefined, 'No change'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Explain the current design'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: { content: markdownMessage('No change') }
    });
    expect(result.appendedEvents.some(({ type }) => type === 'visualization.presented')).toBe(
      false
    );
  });

  it('allows one correction for an unsafe HTML manifest', async () => {
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce(htmlGeneration(manifest('<script>alert(1)</script>'), 'First'))
      .mockResolvedValueOnce(htmlGeneration(manifest('<main>Corrected</main>'), 'Corrected'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Create it'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(2);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'ai.generation-requested')
    ).toHaveLength(2);
    expect(result.appendedEvents.some(({ type }) => type === 'visualization.presented')).toBe(true);
  });

  it('uses the shared fifth-attempt fallback for repeatedly unsafe HTML', async () => {
    mocks.generatePrepared.mockReset().mockImplementation(async (prompt) =>
      prompt.attempt.purpose === 'fallback'
        ? htmlGeneration(manifest('<main>Simple and safe</main>'), 'Simplified result', {
            struggledWith: 'the interactive controls',
            simplified: 'the interaction into static explanatory frames'
          })
        : htmlGeneration(manifest('<script>alert(1)</script>'), 'Unsafe attempt')
    );
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { creation: { templateId: 'blank', mode: 'html' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Create an interactive explanation'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(5);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'ai.generation-requested').at(-1)
    ).toMatchObject({ payload: { purpose: 'fallback', attempt: 5 } });
    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: {
        content: [
          expect.objectContaining({ type: 'markdown', text: expect.stringContaining('controls') }),
          { type: 'markdown', text: 'Simplified result' }
        ]
      }
    });
  });

  it('records four failed repairs and one failed simplification before stopping', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Finite repair' }, serviceDependencies);
    const operationId = '12345678-1234-4123-8123-123456789abc';

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Change the visualization'),
        focus: [],
        presentationCount: 1,
        operationId
      },
      commandDependencies
    );

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(5);
    expect(
      result.appendedEvents.filter(({ type }) => type === 'ai.generation-requested')
    ).toHaveLength(5);
    expect(result.appendedEvents.filter(({ type }) => type === 'build.failed')).toHaveLength(5);
    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'system.notified',
      payload: { severity: 'error' }
    });
    expect(result.appendedEvents.every((event) => event.operationId === operationId)).toBe(true);
    const revisionEvents = result.appendedEvents.filter(
      (event) => event.type === 'ai.generation-requested' || event.type === 'build.requested'
    );
    expect(revisionEvents).toHaveLength(10);
    expect(
      result.document.events.filter(({ type }) => type === 'artifact.version-created')
    ).toHaveLength(1);
    expect(
      result.document.events.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(0);
  });

  it('does not start a repair without one complete provider timeout before the deadline', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Deadline repair' }, serviceDependencies);
    const controller = new AbortController();

    const result = await runWithProjectOperationSignal(
      controller.signal,
      () =>
        submitProjectFeedback(
          {
            projectId: created.projectId,
            expectedHead: projectHead(created).id,
            content: markdownMessage('Change the visualization'),
            focus: [],
            presentationCount: 1,
            operationId: '12345678-1234-4123-8123-123456789abc'
          },
          commandDependencies
        ),
      Date.now() + 179_000
    );

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(1);
    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'system.notified',
      payload: { message: expect.stringContaining('not enough time left') }
    });
  });

  it('tells an AI request that timed out from one cancelled, as the openai SDK throws them', async () => {
    const { APIConnectionTimeoutError, APIUserAbortError } = await import('openai');
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const failure = async (error: Error) => {
      mocks.generatePrepared.mockReset().mockRejectedValue(error);
      const created = await createProject({ title: 'Provider errors' }, serviceDependencies);
      const result = await submitProjectFeedback(
        feedbackOptions(created, 'Create a visualization', '12345678-1234-4123-8123-123456789abc'),
        commandDependencies
      );
      return result.appendedEvents.find((event) => event.type === 'ai.generation-failed');
    };

    expect(await failure(new APIConnectionTimeoutError())).toMatchObject({
      payload: { failureKind: 'timeout', message: 'The AI request timed out.' }
    });
    expect(await failure(new APIUserAbortError())).toMatchObject({
      payload: { failureKind: 'cancelled' }
    });
  });

  it('stores the raw provider response when structured output is incomplete', async () => {
    const providerResponse = {
      id: 'response-incomplete',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: []
    };
    mocks.generatePrepared.mockReset().mockRejectedValue(
      Object.assign(new Error('The chatbot response was incomplete (max_output_tokens).'), {
        name: 'InvalidChatbotResponseError',
        providerResponse
      })
    );
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Provider audit' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Create a visualization'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );
    const failed = result.appendedEvents.find((event) => event.type === 'ai.generation-failed');

    expect(mocks.generatePrepared).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({
      type: 'ai.generation-failed',
      payload: {
        failureKind: 'invalid-response',
        message: 'The chatbot response was incomplete (max_output_tokens).',
        details: { mediaType: 'application/json' }
      }
    });
    if (failed?.type !== 'ai.generation-failed' || !failed.payload.details) {
      throw new Error('Expected a recorded generation failure.');
    }
    const details = JSON.parse(failed.payload.details.text);
    expect(details.providerResponse).toEqual(providerResponse);
  });

  it('records invalid candidate references as generation failures before success', async () => {
    const providerResponse = { id: 'response-invalid-reference' };
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: [{ type: 'candidate-ref', slot: 0 }],
      decision: { action: 'respond' },
      prompt: {},
      providerResponse,
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Invalid candidate reference', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Explain it'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(result.appendedEvents.some(({ type }) => type === 'ai.generation-succeeded')).toBe(
      false
    );
    const failed = result.appendedEvents.find(({ type }) => type === 'ai.generation-failed');
    expect(failed).toMatchObject({
      type: 'ai.generation-failed',
      payload: {
        failureKind: 'invalid-response',
        message: 'The assistant referenced unavailable candidate slot 0.'
      }
    });
    if (failed?.type !== 'ai.generation-failed' || !failed.payload.details) {
      throw new Error('Expected invalid response details.');
    }
    expect(JSON.parse(failed.payload.details.text).providerResponse).toEqual(providerResponse);
  });

  it('turns a known presentation UUID in assistant Markdown into a retained reference', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Assistant presentation reference', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presentationId = presentedEvent(created).payload.presentation.presentationId;
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage(`I prefer presentation \`${presentationId}\` here.`),
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Which treatment is clearer?'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: {
        content: [
          { type: 'markdown', text: 'I prefer presentation ' },
          { type: 'presentation-ref', presentationId },
          { type: 'markdown', text: ' here.' }
        ]
      }
    });
  });

  it('repairs a garbled presentation reference in a reply instead of failing the turn', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Garbled reference', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presentationId = presentedEvent(created).payload.presentation.presentationId;
    // The model kept the first group of the id and invented the rest.
    const garbled = `${presentationId.split('-')[0]}-4e6e-45d3-8e43-c9be3d3e3c9a`;
    const unrelated = '99999999-4e6e-45d3-8e43-c9be3d3e3c9a';
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: [
        { type: 'markdown', text: 'I kept ' },
        { type: 'presentation-ref', presentationId: garbled },
        { type: 'markdown', text: ' over ' },
        { type: 'presentation-ref', presentationId: unrelated },
        { type: 'markdown', text: '.' }
      ],
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Which one?'),
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(result.appendedEvents.at(-1)).toMatchObject({
      type: 'assistant.responded',
      payload: {
        content: [
          { type: 'markdown', text: 'I kept ' },
          { type: 'presentation-ref', presentationId },
          { type: 'markdown', text: ' over ' },
          { type: 'markdown', text: 'that presentation' },
          { type: 'markdown', text: '.' }
        ]
      }
    });
  });

  it('resolves focused history into historical source and presentation context', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('No source change needed.'),
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Focused history', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presentation = presentedEvent(created);

    await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Use this as context'),
        focus: [presentation.id],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(mocks.preparePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          selected: expect.objectContaining({
            events: [
              expect.objectContaining({
                event: expect.objectContaining({ id: presentation.id }),
                workspace: expect.objectContaining({
                  artifacts: [expect.objectContaining({ source: expect.any(String) })]
                }),
                activePresentations: [
                  expect.objectContaining({
                    eventId: presentation.id,
                    seed: presentation.payload.presentation.seed,
                    contentSha256: presentation.payload.presentation.javascript.sha256
                  })
                ]
              })
            ]
          })
        })
      })
    );
  });

  it('retains and expands the presentations visible when feedback was submitted', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('Noted.'),
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Presentation context', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presentation = presentedEvent(created);
    const presentationId = presentation.payload.presentation.presentationId;

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: [
          ...markdownMessage('Use the version I am viewing'),
          { type: 'presentation-ref', presentationId }
        ],
        focus: [],
        presentationCount: 1,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    expect(result.appendedEvents[0]).toMatchObject({
      type: 'feedback.submitted',
      payload: {
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'presentation-ref', presentationId })
        ])
      }
    });
    expect(mocks.preparePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          selected: expect.objectContaining({
            presentations: [
              expect.objectContaining({
                eventId: presentation.id,
                presentationId,
                seed: presentation.payload.presentation.seed
              })
            ]
          })
        })
      })
    );
  });

  it('rejects an unknown presentation reference before prompting the assistant', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Selection validation', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );

    await expect(
      submitProjectFeedback(
        {
          projectId: created.projectId,
          expectedHead: projectHead(created).id,
          focus: [],
          content: [
            {
              type: 'presentation-ref',
              presentationId: '32345678-1234-4123-8123-123456789abc'
            }
          ],
          presentationCount: 1,
          operationId: '12345678-1234-4123-8123-123456789abc'
        },
        commandDependencies
      )
    ).rejects.toThrow('Unknown selected presentation');
    expect(mocks.generatePrepared).not.toHaveBeenCalled();
  });

  it('keeps the step a presentation was viewed at, refusing a step it does not have', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('Noted.'),
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Viewed step', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const { presentationId } = presentedEvent(created).payload.presentation;
    const submit = (step: number) =>
      submitProjectFeedback(
        {
          projectId: created.projectId,
          expectedHead: projectHead(created).id,
          content: [
            { type: 'presentation-ref', presentationId, step, stepName: '@guess#1' },
            ...markdownMessage('Here')
          ],
          focus: [],
          presentationCount: 1,
          operationId: '12345678-1234-4123-8123-123456789abc'
        },
        commandDependencies
      );

    await expect(submit(99)).rejects.toThrow('has no step 100');
    const result = await submit(1);
    const feedback = result.document.events.find((event) => event.type === 'feedback.submitted');
    // Named as the presentation names the step, whatever name the message gave.
    expect(feedback?.type === 'feedback.submitted' && feedback.payload.content[0]).toEqual({
      type: 'presentation-ref',
      presentationId,
      step: 1,
      stepName: '@first#1'
    });
  });

  it('traces a referenced element to its node in the presentation source for the assistant', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('Noted.'),
      decision: { action: 'respond' },
      prompt: {},
      generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
    });
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject(
      { title: 'Element context', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presentation = presentedEvent(created).payload.presentation;
    if (presentation.format !== 'browser-bundle-v1') throw new Error('Expected a Sverlin bundle.');
    const lines = presentation.source.text.split('\n');
    const line = lines.findIndex((text) => text.startsWith('{#snippet Title()}')) + 1;
    const column = '{#snippet Title()}'.length + 1;
    const reference: ElementReference = {
      type: 'element-ref',
      presentationId: presentation.presentationId,
      step: 1,
      element: {
        id: `${line}:${column}`,
        label: 'Linear search',
        layouts: [{ node: `${line}:${column}`, seed: 7, form: 'snake' }]
      }
    };
    const submit = (content: ElementReference[]) =>
      submitProjectFeedback(
        {
          projectId: created.projectId,
          expectedHead: projectHead(created).id,
          content: [...markdownMessage('Make this larger'), ...content],
          focus: [],
          presentationCount: 1,
          operationId: '12345678-1234-4123-8123-123456789abc'
        },
        commandDependencies
      );

    await expect(
      submit([{ ...reference, element: { id: `${line}:2`, label: 'x' } }])
    ).rejects.toThrow('is not a node of that presentation');
    await expect(submit([{ ...reference, step: 99 }])).rejects.toThrow('has no step 100');
    await expect(
      submit([
        { ...reference, element: { ...reference.element, layouts: [{ node: '1:1', seed: 7 }] } }
      ])
    ).rejects.toThrow('Layout node 1:1 is not a node');
    expect(mocks.generatePrepared).not.toHaveBeenCalled();

    await submit([reference]);
    expect(mocks.preparePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          selected: expect.objectContaining({
            elements: [
              {
                presentationId: presentation.presentationId,
                step: 1,
                stepLabel: presentation.labels[1],
                elementId: `${line}:${column}`,
                label: 'Linear search',
                source: expect.objectContaining({
                  line,
                  column,
                  occurrence: 1,
                  markup: expect.stringContaining('Linear search')
                }),
                layouts: [
                  {
                    node: `${line}:${column}`,
                    layoutSeed: 7,
                    form: 'snake',
                    source: expect.objectContaining({ line, column })
                  }
                ]
              }
            ]
          })
        })
      })
    );
  });
});

function generation(
  source: string | undefined,
  reply: string,
  recovery?: { struggledWith: string; simplified: string }
) {
  return {
    reply: markdownMessage(reply),
    decision:
      source === undefined
        ? { action: 'respond' as const }
        : {
            action: 'revise' as const,
            source: source.startsWith('broken')
              ? '<script>import unavailable from "elsewhere";</script><h1>Broken</h1>'
              : `<script algorithm></script>{#snippet Shown()}<Node>${source}</Node>{/snippet}\n<Layout name="Main"><Node>{@render Shown()}</Node></Layout>`,
            summary: reply
          },
    ...(recovery ? { recovery } : {}),
    prompt: {
      initialPrompt: 'test prompt',
      messages: [],
      context: {},
      parameters: { model: 'test-model' },
      responseFormat: { name: 'test', schema: {} }
    },
    generation: {
      botId: 'sverlin-assistant',
      adapterId: 'test-adapter',
      model: 'test-model'
    }
  };
}

function generationPrompt(purpose: 'initial' | 'repair' | 'fallback') {
  return {
    initialPrompt: 'test prompt',
    messages: [],
    context: {},
    attempt: { number: 1, purpose },
    parameters: { model: 'test-model' },
    responseFormat: { name: 'test', schema: {} }
  };
}

async function withActiveIntake(
  document: ProjectDocument,
  intakeStep: 'algorithm'
): Promise<ProjectDocument> {
  const appended = await serviceDependencies.repository.append(
    document.projectId,
    projectHead(document).id,
    [
      {
        type: 'assistant.responded',
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        operationId: '12345678-1234-4123-8123-123456789a00',
        createdAt: '2026-08-31T00:00:00.000Z',
        payload: {
          content: markdownMessage('Intake question'),
          intakeStep
        }
      }
    ]
  );
  return appended.document;
}

function feedbackOptions(document: ProjectDocument, text: string, operationId: string) {
  return {
    projectId: document.projectId,
    expectedHead: projectHead(document).id,
    content: markdownMessage(text),
    focus: [],
    presentationCount: 2 as const,
    operationId
  };
}

async function createComparisonProject(title: string): Promise<{
  document: ProjectDocument;
  presentations: Array<
    Extract<ProjectDocument['events'][number], { type: 'visualization.presented' }>
  >;
}> {
  const { createProject } = await import('./service');
  const { submitProjectFeedback } = await import('./commands');
  const created = await createProject({ title }, serviceDependencies);
  mocks.generatePrepared
    .mockReset()
    .mockResolvedValueOnce(generation('valid comparison source', 'Here is one.'))
    .mockResolvedValueOnce({
      ...generation(undefined, 'Compare these candidates.'),
      decision: { action: 'resample' }
    });
  const revised = await submitProjectFeedback(
    {
      projectId: created.projectId,
      expectedHead: projectHead(created).id,
      content: markdownMessage('Create one'),
      focus: [],
      presentationCount: 2,
      operationId: '12345678-1234-4123-8123-123456789abb'
    },
    commandDependencies
  );
  const result = await submitProjectFeedback(
    {
      projectId: created.projectId,
      expectedHead: projectHead(revised.document).id,
      content: markdownMessage('Create a comparison'),
      focus: [],
      presentationCount: 2,
      operationId: '12345678-1234-4123-8123-123456789abc'
    },
    commandDependencies
  );
  return {
    document: result.document,
    presentations: result.appendedEvents.filter(
      (
        event
      ): event is Extract<ProjectDocument['events'][number], { type: 'visualization.presented' }> =>
        event.type === 'visualization.presented'
    )
  };
}

function manifest(html: string) {
  return {
    format: 'sverlin-html-frames' as const,
    version: 1 as const,
    frames: [{ label: 'Overview', html }]
  };
}

function htmlGeneration(
  value: ReturnType<typeof manifest> | undefined,
  reply: string,
  recovery?: { struggledWith: string; simplified: string }
) {
  return {
    reply: markdownMessage(reply),
    candidates: value ? [{ label: 'Candidate', manifest: value }] : [],
    ...(recovery ? { recovery } : {}),
    prompt: {
      initialPrompt: 'html test prompt',
      messages: [],
      context: {},
      parameters: { model: 'test-model' },
      responseFormat: { name: 'html-test', schema: {} }
    },
    generation: {
      botId: 'html-assistant',
      adapterId: 'test-adapter',
      model: 'test-model'
    }
  };
}

type SverlinPresentedEvent = Omit<ProjectEventOf<'visualization.presented'>, 'payload'> & {
  payload: Omit<ProjectEventOf<'visualization.presented'>['payload'], 'presentation'> & {
    presentation: BrowserBundlePresentation;
  };
};

function presentedEvent(document: ProjectDocument): SverlinPresentedEvent {
  const event = document.events.findLast(
    (candidate) => candidate.type === 'visualization.presented'
  );
  if (
    event?.type !== 'visualization.presented' ||
    event.payload.presentation.format !== 'browser-bundle-v1'
  ) {
    throw new Error('Expected a Sverlin presentation event.');
  }
  return event as SverlinPresentedEvent;
}

describe('building on the candidate shown', () => {
  it('makes an earlier candidate’s source the newest version before resampling it', async () => {
    const { buildProjectPresentations, createProject, updateProjectArtifact } =
      await import('./service');
    const created = await createProject(
      { title: 'Earlier candidate', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const presented = (document: ProjectDocument) =>
      document.events.filter(
        (event): event is ProjectEventOf<'visualization.presented'> =>
          event.type === 'visualization.presented'
      );
    const earlier = presented(created)[0].payload.presentation as BrowserBundlePresentation;
    const edited = await updateProjectArtifact(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        artifactId: 'main',
        source: `${earlier.source.text}\n{#snippet Edited()}<Node>Edited</Node>{/snippet}{@render Edited()}`,
        presentationCount: 1,
        operationId: '22345678-1234-4123-8123-123456789abc'
      },
      serviceDependencies
    );

    const resampled = await buildProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(edited.document).id,
        presentationCount: 1,
        from: earlier.presentationId,
        operationId: '32345678-1234-4123-8123-123456789abc'
      },
      serviceDependencies
    );

    const version = resampled.appendedEvents.find(
      (event): event is ProjectEventOf<'artifact.version-created'> =>
        event.type === 'artifact.version-created'
    );
    expect(version?.payload.origin).toEqual({
      kind: 'candidate',
      presentationId: earlier.presentationId
    });
    const snapshot = projectSnapshotAt(resampled.document);
    expect(snapshot.artifacts[snapshot.entryArtifactId].content.text).toBe(earlier.source.text);
    const [rebuilt] = presented(resampled.document).slice(-1);
    expect((rebuilt.payload.presentation as BrowserBundlePresentation).source.text).toBe(
      earlier.source.text
    );
  });

  it('leaves the newest source alone when the candidate shown was built from it', async () => {
    const { buildProjectPresentations, createProject } = await import('./service');
    const created = await createProject(
      { title: 'Newest candidate', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const shown = created.events.find(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented'
    );
    const resampled = await buildProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        presentationCount: 1,
        from: shown!.payload.presentation.presentationId,
        operationId: '42345678-1234-4123-8123-123456789abc'
      },
      serviceDependencies
    );
    expect(resampled.appendedEvents.map(({ type }) => type)).not.toContain(
      'artifact.version-created'
    );
  });
});

describe('version parents', () => {
  it('links each version to the one it was made from, unless written from scratch', async () => {
    const { createProject, updateProjectArtifact } = await import('./service');
    const created = await createProject(
      { title: 'Tree', creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const versions = (document: ProjectDocument) =>
      document.events.filter(
        (event): event is ProjectEventOf<'artifact.version-created'> =>
          event.type === 'artifact.version-created'
      );
    const [initial] = versions(created);
    const source =
      initial.payload.changes[0].operation === 'upsert'
        ? initial.payload.changes[0].artifact.content.text
        : '';
    const save = (document: ProjectDocument, extra: object, operationId: string) =>
      updateProjectArtifact(
        {
          projectId: created.projectId,
          expectedHead: projectHead(document).id,
          artifactId: 'main',
          source: `${source}\n{#snippet Saved()}<Node>${operationId.slice(0, 2)}</Node>{/snippet}{@render Saved()}`,
          presentationCount: 1,
          operationId,
          ...extra
        },
        serviceDependencies
      );

    const child = await save(
      created,
      { summary: 'Adds a caption' },
      '52345678-1234-4123-8123-123456789abc'
    );
    const fresh = await save(
      child.document,
      { root: true },
      '62345678-1234-4123-8123-123456789abc'
    );

    const [, childVersion, freshVersion] = versions(fresh.document);
    expect(initial.payload.parent).toBeUndefined();
    expect(childVersion.payload).toMatchObject({ parent: initial.id, summary: 'Adds a caption' });
    expect(freshVersion.payload.parent).toBeUndefined();
  });
});

describe('assistant edits', () => {
  const edit = (edits: { find: string; replace: string }[], summary: string) => ({
    ...generation(undefined, 'Edited.'),
    decision: { action: 'edit' as const, edits, summary }
  });
  const created = async (title: string) => {
    const { createProject } = await import('./service');
    const document = await createProject(
      { title, creation: { templateId: 'linear-search' } },
      serviceDependencies
    );
    const snapshot = projectSnapshotAt(document);
    return { document, source: snapshot.artifacts[snapshot.entryArtifactId].content.text };
  };
  const feedback = async (document: ProjectDocument) => {
    const { submitProjectFeedback } = await import('./commands');
    return submitProjectFeedback(
      {
        projectId: document.projectId,
        expectedHead: projectHead(document).id,
        content: markdownMessage('Add a caption.'),
        focus: [],
        presentationCount: 1,
        operationId: '72345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );
  };
  const version = (document: ProjectDocument) =>
    document.events.findLast(
      (event): event is ProjectEventOf<'artifact.version-created'> =>
        event.type === 'artifact.version-created'
    );

  it('applies the edits to the source it revises, and records what they change', async () => {
    const { document, source } = await created('Edited');
    // The caption is a part, rendered in the layout, as the top level holds only parts and layouts.
    const captioned = source
      .replace(
        '<Layout name="Main">',
        '{#snippet Note()}<Node>Caption</Node>{/snippet}\n<Layout name="Main">'
      )
      .replace('{@render Result()}', '{@render Result()}{@render Note()}');
    mocks.generatePrepared.mockReset().mockResolvedValue(
      edit(
        [
          {
            find: '<Layout name="Main">',
            replace: '{#snippet Note()}<Node>Caption</Node>{/snippet}\n<Layout name="Main">'
          },
          { find: '{@render Result()}', replace: '{@render Result()}{@render Note()}' }
        ],
        'Adds a caption'
      )
    );

    const result = await feedback(document);

    const revised = version(result.document);
    expect(revised?.payload).toMatchObject({
      origin: { kind: 'assistant-edit' },
      summary: 'Adds a caption'
    });
    const [change] = revised?.payload.changes ?? [];
    expect(change?.operation === 'upsert' && change.artifact.content.text).toBe(captioned);
  });

  it('builds an edited source with the values the edit gives, as where it pauses', async () => {
    const { document } = await created('Paced edit');
    mocks.generatePrepared.mockReset().mockResolvedValue({
      ...generation(undefined, 'Edited.'),
      decision: {
        action: 'edit' as const,
        edits: [
          {
            find: '<Layout name="Main">',
            replace: '{#snippet Note()}<Node>Caption</Node>{/snippet}\n<Layout name="Main">'
          },
          { find: '{@render Result()}', replace: '{@render Result()}{@render Note()}' }
        ],
        values: [{ variable: 'pause@missing', value: 'off' }],
        summary: 'Adds a caption'
      }
    });

    const result = await feedback(document);

    const [presentation] = result.appendedEvents.flatMap((event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1'
        ? [event.payload.presentation]
        : []
    );
    expect(presentation?.variant?.['pause@missing']).toBe('off');
    expect(presentation?.origins?.['pause@missing']).toBe('chosen');
    expect(presentation?.variant?.['pause@check.equal']).toBe('on');
  });

  it('asks again with what kept the edits from applying, and accepts the correction', async () => {
    const { document } = await created('Misplaced edit');
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce(edit([{ find: 'text not in the source', replace: '' }], 'Nothing'))
      .mockResolvedValueOnce(generation('Corrected', 'Corrected.'));

    const result = await feedback(document);

    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.diagnostics).toEqual([
      expect.objectContaining({ code: 'edit_not_applied' })
    ]);
    const rejected = result.document.events.find(({ type }) => type === 'revision.edits-rejected');
    expect(rejected?.payload).toMatchObject({
      attempt: 1,
      problems: [expect.stringContaining('Edit 1')]
    });
    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.buildEventId).toBe(rejected?.id);
    const [change] = version(result.document)?.payload.changes ?? [];
    expect(change?.operation === 'upsert' && change.artifact.content.text).toContain('Corrected');
  });

  it('varies the viewed variant in one version, where two are shown: chosen values set, the rest kept', async () => {
    const { createProject } = await import('./service');
    const { runQueuedAssistantTurn } = await import('./commands');
    const document = await createProject(
      { title: 'Varied', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    const presented = (events: readonly ProjectEvent[]) =>
      events.flatMap((event) =>
        event.type === 'visualization.presented' &&
        event.payload.presentation.format === 'browser-bundle-v1'
          ? [event.payload.presentation]
          : []
      );
    // The older of the pair, so the newest presentation cannot stand in for it.
    const [viewed] = presented(document.events);
    const before = viewed.variant ?? {};
    const head = projectHead(document).id;
    const feedbackOperationId = '82345678-1234-4123-8123-123456789abc';
    const assistantOperationId = '82345678-1234-4123-8123-123456789abd';
    await serviceDependencies.repository.append(document.projectId, head, [
      {
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        operationId: feedbackOperationId,
        createdAt: '2026-08-30T12:00:00.000Z',
        payload: {
          content: markdownMessage('Try tallies.'),
          focus: [],
          presentationCount: 2,
          from: viewed.presentationId
        }
      },
      {
        type: 'assistant.turn-requested',
        actor: { kind: 'system' },
        operationId: feedbackOperationId,
        createdAt: '2026-08-30T12:00:01.000Z',
        payload: { interactionEventId: head + 1, presentationCount: 2 }
      },
      {
        type: 'operation.accepted',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:02.000Z',
        payload: { kind: 'assistant-turn' }
      },
      {
        type: 'assistant.turn-started',
        actor: { kind: 'system' },
        operationId: assistantOperationId,
        createdAt: '2026-08-30T12:00:03.000Z',
        payload: { requestEventIds: [head + 2], interactionEventIds: [head + 1] }
      }
    ]);
    mocks.generatePrepared.mockReset().mockResolvedValue({
      ...generation(undefined, 'Varied.'),
      decision: {
        action: 'vary' as const,
        values: [{ variable: 'views.Int', value: 'IntTally' }],
        randomise: ['Highlight.Pointed.fill'],
        summary: 'Draws every value with a tally'
      }
    });

    const result = await runQueuedAssistantTurn(
      { projectId: document.projectId, operationId: assistantOperationId },
      commandDependencies
    );

    expect(result.appendedEvents.map(({ type }) => type)).not.toContain('artifact.version-created');
    // A vary without a count or comparisons presents one version, not an unlabelled pair.
    const shown = presented(result.appendedEvents);
    expect(shown).toHaveLength(1);
    const [first] = shown;
    const origins = (presentation: BrowserBundlePresentation) =>
      Object.fromEntries(
        Object.entries(presentation.variant ?? {}).map(([key, value]) => [
          key,
          { value, origin: presentation.origins?.[key] }
        ])
      );
    expect(origins(first)['views.Int']).toEqual({ value: 'IntTally', origin: 'chosen' });
    expect(origins(first)['Highlight.Pointed.fill'].origin).not.toBe('chosen');
    // A place's view choice follows views.Int, and its paint the randomised fill (see buildVariant).
    const follows = (key: string) =>
      /^views\.(\w+\.)?Int@/u.test(key) || /^Highlight\.Pointed@\w+\.fill$/u.test(key);
    for (const [key, { value, origin }] of Object.entries(origins(first)))
      if (key !== 'views.Int' && key !== 'Highlight.Pointed.fill' && !follows(key))
        expect({ value, origin }).toEqual({ value: before[key], origin: 'kept' });
  });
});

describe('several variants from chat', () => {
  const chooser = (generatePrepared: ReturnType<typeof vi.fn>) =>
    ({
      preparePrompt: async (request: { project: unknown }) => ({
        initialPrompt: 'Choose',
        messages: [],
        context: { project: request.project },
        attempt: { number: 1, purpose: 'choosing' },
        parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
        responseFormat: { name: 'design_variants', schema: {} }
      }),
      generatePrepared,
      requestTimeoutMs: () => 180_000
    }) as unknown as ReturnType<NonNullable<ProjectCommandDependencies['getChooser']>>;
  const fills = ['amber-100', 'blue-100', 'amber-200', 'blue-200'];
  const choosing = vi.fn(async (prompt: { context: { project: Record<string, unknown> } }) => ({
    variants: fills.map((value) => ({
      values: [
        { variable: 'Highlight.Pointed.fill', value },
        // The assistant fixed this; the chooser cannot change it.
        { variable: 'views.Int', value: 'IntText' }
      ],
      randomise: []
    })),
    prompt,
    generation: { botId: 'sverlin-chooser', adapterId: 'test-adapter', model: 'test-model' }
  }));
  const presented = (events: readonly ProjectEvent[]) =>
    events.flatMap((event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1'
        ? [
            {
              payload: {
                displaySetId: event.payload.displaySetId,
                presentation: event.payload.presentation,
                question: event.payload.question,
                label: event.payload.label,
                brief: event.payload.brief,
                differsAt: event.payload.differsAt,
                swapped: event.payload.swapped
              }
            }
          ]
        : []
    );

  /** A shown comparison of linear search, then an assistant turn making the given decision. */
  async function decide(decision: object, dependencies: Partial<ProjectCommandDependencies>) {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title: 'Several', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue({ ...generation(undefined, 'Four to compare.'), decision });
    const result = await submitProjectFeedback(
      feedbackOptions(document, 'Show me a few.', '92345678-1234-4123-8123-123456789abc'),
      { ...commandDependencies, ...dependencies }
    );
    return { before: document, result };
  }

  it('sends a count back to the assistant to design comparisons, never filling it through the chooser', async () => {
    choosing.mockClear();
    const { result } = await decide(
      {
        action: 'vary',
        values: [{ variable: 'views.Int', value: 'IntTally' }],
        randomise: [],
        count: 4,
        summary: 'Tallies with four marks'
      },
      { getChooser: () => chooser(choosing), chooserFor: async () => 'model' }
    );
    expect(choosing).not.toHaveBeenCalled();
    const rejected = result.appendedEvents.filter(({ type }) => type === 'revision.edits-rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected[0])).toContain('A count is not built');
    // On the last attempt the count is ignored: one version, not four.
    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(1);
  });
  const views = (left: string, right: string) => ({
    question: 'Cells or tallies for the numbers?',
    left: { label: left, values: [{ variable: 'views.Int', value: left }] },
    right: { label: right, values: [{ variable: 'views.Int', value: right }] }
  });
  const marks = {
    question: 'Amber or blue marks?',
    left: { label: 'amber', values: [{ variable: 'Highlight.Pointed.fill', value: 'amber-100' }] },
    right: { label: 'blue', values: [{ variable: 'Highlight.Pointed.fill', value: 'blue-100' }] }
  };

  it('builds each comparison as a pair differing only as given, with its question and side labels, the first shown and the rest queued', async () => {
    const choose = vi.fn();
    const tone = { attribute: 'tone', left: 'restrained', right: 'bold' };
    const { before, result } = await decide(
      {
        action: 'vary',
        values: [],
        randomise: [],
        count: null,
        comparisons: [views('IntCell', 'IntTally'), { ...marks, brief: tone }],
        summary: 'Asks two questions'
      },
      { getChooser: () => chooser(choose), chooserFor: async () => 'model' }
    );

    expect(choose).not.toHaveBeenCalled();
    const shown = presented(result.appendedEvents);
    expect(shown).toHaveLength(4);
    // With no presentation named, the turn builds on the newest (viewedPresentation).
    const viewed = presented(before.events).at(-1)!.payload.presentation;
    // Each pair differs only in what its comparison sets, and the variables that follow them.
    const following = [/^views\.(\w+\.)?Int(@.*)?$/u, /^Highlight\.Pointed(@\w+)?\.fill$/u];
    for (const index of [0, 1]) {
      const [left, right] = shown.slice(index * 2, index * 2 + 2).map(({ payload }) => payload);
      expect(left.displaySetId).toBe(right.displaySetId);
      expect(left.question).toBe(
        index ? 'Amber or blue marks?' : 'Cells or tallies for the numbers?'
      );
      expect([left.label, right.label]).toEqual(
        index ? ['amber', 'blue'] : ['IntCell', 'IntTally']
      );
      // A pair asking a brief attribute by showing records the tag each side stands for.
      expect([left.brief, right.brief]).toEqual(
        index
          ? [
              { key: 'tone', tag: 'restrained' },
              { key: 'tone', tag: 'bold' }
            ]
          : [undefined, undefined]
      );
      const differing = Object.keys({
        ...left.presentation.variant,
        ...right.presentation.variant
      }).filter((key) => left.presentation.variant?.[key] !== right.presentation.variant?.[key]);
      expect(differing.length).toBeGreaterThan(0);
      expect(differing.every((key) => following[index].test(key))).toBe(true);
      // Nothing is drawn afresh: every other value is the viewed variant's.
      for (const [key, value] of Object.entries(left.presentation.variant ?? {}))
        if (!following[index].test(key) && key in (viewed.variant ?? {}))
          expect(value).toBe(viewed.variant?.[key]);
    }
    const { presentationBufferState, waitingBehind } =
      await import('$lib/shared/projects/presentation-buffer');
    const buffer = presentationBufferState(result.document, 0);
    expect(buffer.available.map(({ presentationId }) => presentationId)).toEqual(
      shown.map(({ payload }) => payload.presentation.presentationId)
    );
    expect(waitingBehind(buffer, buffer.available[0].presentationId)).toHaveLength(2);
  });

  it('shows a pair the other way round where its order is drawn so, recording it', async () => {
    const tone = { attribute: 'tone', left: 'restrained', right: 'bold' };
    const { result } = await decide(
      {
        action: 'vary',
        values: [],
        randomise: [],
        count: null,
        comparisons: [{ ...marks, brief: tone }],
        summary: 'Asks one question'
      },
      { comparisonOrder: () => 0.9 }
    );
    const [top, bottom] = presented(result.appendedEvents).map(({ payload }) => payload);
    expect([top.label, bottom.label]).toEqual(['blue', 'amber']);
    expect([top.brief?.tag, bottom.brief?.tag]).toEqual(['bold', 'restrained']);
    expect([top.swapped, bottom.swapped]).toEqual([true, true]);
  });

  it('names in words a version a single view queues behind the first, rather than failing', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title: 'Single', creation: { templateId: 'linear-search' }, presentationCount: 1 },
      serviceDependencies
    );
    mocks.generatePrepared.mockReset().mockResolvedValue({
      ...generation(undefined, 'unused'),
      reply: [
        { type: 'candidate-ref', slot: 0 },
        { type: 'markdown', text: ' and ' },
        { type: 'candidate-ref', slot: 1 },
        { type: 'markdown', text: ' are the first two.' }
      ],
      decision: {
        action: 'vary',
        values: [],
        randomise: [],
        count: 4,
        comparisons: null,
        summary: 'Four looks'
      }
    });
    const result = await submitProjectFeedback(
      {
        ...feedbackOptions(document, 'Show me a few.', '92345678-1234-4123-8123-123456789abe'),
        presentationCount: 1
      },
      {
        ...commandDependencies,
        getChooser: () => chooser(vi.fn()),
        chooserFor: async () => 'random'
      }
    );
    expect(result.appendedEvents.some(({ type }) => type === 'operation.failed')).toBe(false);
    const reply = result.appendedEvents.findLast(({ type }) => type === 'assistant.responded');
    expect(JSON.stringify(reply)).toContain('the next version');
  });

  it('reports comparisons that cannot be built as given back to the assistant to repair', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title: 'Invalid', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce({
        ...generation(undefined, 'Two questions.'),
        decision: {
          action: 'vary',
          values: [],
          randomise: [],
          count: null,
          comparisons: [
            views('IntCell', 'IntBogus'),
            views('IntCell', 'IntCell'),
            {
              ...views('IntCell', 'IntTally'),
              brief: { attribute: 'tone', left: 'restrained', right: 'novice' }
            }
          ],
          summary: 'Asks three questions'
        }
      })
      .mockResolvedValueOnce(generation(undefined, 'Sorry.'));

    const result = await submitProjectFeedback(
      feedbackOptions(document, 'Compare.', '93345678-1234-4123-8123-123456789abc'),
      commandDependencies
    );

    const rejected = result.appendedEvents.find(({ type }) => type === 'revision.edits-rejected');
    expect(rejected?.payload).toMatchObject({
      rejected: 'comparisons',
      problems: [
        expect.stringContaining('IntBogus'),
        expect.stringContaining('the same values'),
        expect.stringContaining('tone has no tag "novice"')
      ]
    });
    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.diagnostics).toEqual([
      expect.objectContaining({ code: 'comparison_not_built' }),
      expect.objectContaining({ code: 'comparison_not_built' }),
      expect.objectContaining({ code: 'comparison_not_built' })
    ]);
    expect(presented(result.appendedEvents)).toEqual([]);
  });

  it('records the brief a decision sets with its reply, and keeps what it rules out of comparisons', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title: 'Grey', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    const brief = [
      {
        key: 'constraints',
        value: 'printed in grey',
        status: 'confirmed',
        source: 'it gets printed in grey',
        tags: ['greyscale']
      }
    ];
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValueOnce({
        ...generation(undefined, 'Two questions.'),
        decision: {
          action: 'vary',
          values: [],
          randomise: [],
          count: null,
          comparisons: [marks],
          summary: 'Asks about the marks'
        },
        brief
      })
      // The repair asks no colour question and does not restate the brief, which still holds.
      .mockResolvedValueOnce({
        ...generation(undefined, 'Here it is, in grey.'),
        decision: {
          action: 'vary',
          values: [],
          randomise: [],
          count: null,
          comparisons: null,
          summary: 'Keeps the look'
        }
      });

    const result = await submitProjectFeedback(
      feedbackOptions(document, 'It gets printed in grey.', '94345678-1234-4123-8123-123456789abc'),
      commandDependencies
    );

    const reply = result.appendedEvents.find(({ type }) => type === 'assistant.responded');
    expect(reply?.payload).toMatchObject({ brief });
    const rejected = result.appendedEvents.find(({ type }) => type === 'revision.edits-rejected');
    expect(rejected?.payload).toMatchObject({
      rejected: 'comparisons',
      problems: [expect.stringContaining('it must print in grey')]
    });
    expect(replies(result.appendedEvents)).toHaveLength(1);
    expect(presented(result.appendedEvents).every(({ payload }) => !payload.question)).toBe(true);
  });

  /** An assistant turn on a new linear search, each attempt making the decision given for it. */
  async function attempts(
    decide: (prompt: { attempt: { number: number; purpose: string } }) => object,
    title: string
  ) {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title, creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    mocks.generatePrepared.mockReset().mockImplementation(async (prompt) => decide(prompt));
    return submitProjectFeedback(
      feedbackOptions(document, 'Compare.', '95345678-1234-4123-8123-123456789abc'),
      commandDependencies
    );
  }
  const vary = (reply: string, more: object) => ({
    ...generation(undefined, reply),
    decision: { action: 'vary', values: [], randomise: [], count: null, summary: 'Asks', ...more }
  });
  const replies = (events: readonly ProjectEvent[]) =>
    events.flatMap((event) => (event.type === 'assistant.responded' ? [event.payload] : []));

  it('records only the reply of the attempt whose decision is accepted, with its question', async () => {
    const result = await attempts(
      ({ attempt }) =>
        attempt.number === 1
          ? vary('Two wait for your answers.', {
              comparisons: [views('IntCell', 'IntBogus'), views('IntCell', 'IntCell')]
            })
          : vary('Tallies, then a question.', {
              values: [{ variable: 'views.Int', value: 'IntTally' }],
              question: { text: 'Warm or cool highlighting next?', presentation: null }
            }),
      'Accepted reply'
    );

    expect(replies(result.appendedEvents)).toEqual([
      {
        content: markdownMessage('Tallies, then a question.'),
        question: { text: 'Warm or cool highlighting next?' }
      }
    ]);
    expect(presented(result.appendedEvents).length).toBeGreaterThan(0);
  });

  it('repairs comparisons some of which cannot be built, telling the assistant to keep the others', async () => {
    const result = await attempts(
      ({ attempt }) =>
        attempt.number === 1
          ? vary('Two wait.', { comparisons: [views('IntCell', 'IntBogus'), marks] })
          : vary('One to answer.', { comparisons: [marks] }),
      'Partly invalid'
    );

    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.diagnostics).toEqual([
      expect.objectContaining({
        code: 'comparison_not_built',
        message: expect.stringMatching(/^Comparison 1 .*IntBogus/u)
      }),
      expect.objectContaining({
        code: 'comparison_kept',
        message: expect.stringContaining('Comparison 2 (“Amber or blue marks?”) can be built')
      })
    ]);
    expect(replies(result.appendedEvents).map(({ content }) => content)).toEqual([
      markdownMessage('One to answer.')
    ]);
    expect(presented(result.appendedEvents).map(({ payload }) => payload.question)).toEqual([
      'Amber or blue marks?',
      'Amber or blue marks?'
    ]);
  });

  it('builds the comparisons that can be built on the last attempt, the reply saying which were left out', async () => {
    const result = await attempts(
      ({ attempt }) => ({
        ...vary('Two wait.', { comparisons: [views('IntCell', 'IntBogus'), marks] }),
        ...(attempt.purpose === 'fallback'
          ? { recovery: { struggledWith: 'the views', simplified: 'the questions' } }
          : {})
      }),
      'Last attempt'
    );

    const rejected = result.appendedEvents.filter(
      (event): event is ProjectEventOf<'revision.edits-rejected'> =>
        event.type === 'revision.edits-rejected'
    );
    expect(rejected.map(({ payload }) => payload.kept)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      [2]
    ]);
    expect(presented(result.appendedEvents).map(({ payload }) => payload.question)).toEqual([
      'Amber or blue marks?',
      'Amber or blue marks?'
    ]);
    const [reply] = replies(result.appendedEvents);
    expect(replies(result.appendedEvents)).toHaveLength(1);
    expect(reply.content.at(-1)).toEqual({
      type: 'markdown',
      text: 'Two wait. I left out “Cells or tallies for the numbers?”, which could not be built as asked.'
    });
  });

  // A cell's least size is under what the highlight keeps, so the two sides draw alike.
  const sizes = {
    question: 'Smaller or larger cells?',
    left: { label: 'smaller', values: [{ variable: 'IntCell.minSize', value: 1 }] },
    right: { label: 'larger', values: [{ variable: 'IntCell.minSize', value: 2 }] }
  };

  it('sends a picture too large to read back once, then shows it as built', async () => {
    const wide = [
      '<script algorithm></script>',
      '<Layout name="Main"><Node layout="row">',
      ...Array.from({ length: 150 }, (_, index) => `<Node>cell ${index}</Node>`),
      '</Node></Layout>'
    ].join('\n');
    const result = await attempts(
      () => ({
        ...generation(undefined, 'All of it.'),
        decision: { action: 'revise', source: wide, summary: 'Every cell' }
      }),
      'Too large'
    );

    const rejected = result.appendedEvents.filter(({ type }) => type === 'revision.edits-rejected');
    expect(rejected.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({
        rejected: 'picture',
        problems: [expect.stringContaining('The picture is too large to read')]
      })
    ]);
    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'picture_unreadable' })
    );
    expect(mocks.generatePrepared).toHaveBeenCalledTimes(2);
    expect(result.appendedEvents.some(({ type }) => type === 'artifact.version-created')).toBe(
      true
    );
  });

  it('sends back a comparison whose sides draw alike at every step, and records where a pair differs', async () => {
    const result = await attempts(
      ({ attempt }) =>
        attempt.number === 1
          ? vary('Two wait.', { comparisons: [sizes, marks] })
          : vary('One to answer.', { comparisons: [marks] }),
      'Drawn alike'
    );

    expect(mocks.preparePrompt.mock.calls[1][0].buildFeedback.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'comparison_not_built',
        message:
          'Comparison 1 (“Smaller or larger cells?”): its two sides draw the same at every step: IntCell.minSize changes nothing visible here. Compare a choice that shows, or leave it out.'
      })
    );
    // The highlight shows from the second step, where the search first sets its position.
    expect(presented(result.appendedEvents).map(({ payload }) => payload.differsAt)).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    ]);
  });

  it('leaves out a comparison drawing alike on the last attempt, showing the next first', async () => {
    const result = await attempts(
      ({ attempt }) => ({
        ...vary('Two wait.', { comparisons: [sizes, marks] }),
        ...(attempt.purpose === 'fallback'
          ? { recovery: { struggledWith: 'the sizes', simplified: 'the questions' } }
          : {})
      }),
      'Alike to the last'
    );

    expect(presented(result.appendedEvents).map(({ payload }) => payload.question)).toEqual([
      'Amber or blue marks?',
      'Amber or blue marks?'
    ]);
    expect(replies(result.appendedEvents)[0].content.at(-1)).toEqual({
      type: 'markdown',
      text: 'Two wait. I left out “Smaller or larger cells?”, which could not be built as asked.'
    });
  });

  it('leaves out a later comparison drawing alike, as one that fails to build', async () => {
    const result = await attempts(
      () => vary('Two wait.', { comparisons: [marks, sizes] }),
      'Later alike'
    );

    expect(presented(result.appendedEvents).map(({ payload }) => payload.question)).toEqual([
      'Amber or blue marks?',
      'Amber or blue marks?'
    ]);
  });

  const caption = [
    {
      find: '<Layout name="Main">',
      replace: '{#snippet Note()}<Node>Caption</Node>{/snippet}\n<Layout name="Main">'
    },
    { find: '{@render Result()}', replace: '{@render Result()}{@render Note()}' }
  ];

  it('records the reply after the version it presents, naming it and asking about it', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Reply last' }, serviceDependencies);
    const decided = generation('valid source', 'unused');
    mocks.generatePrepared.mockReset().mockResolvedValue({
      ...decided,
      reply: [
        { type: 'candidate-ref', slot: 0 },
        { type: 'markdown', text: 'is an initial visualisation of linear search.' }
      ],
      decision: {
        ...decided.decision,
        question: { text: 'Is the target clear?', presentation: 'new', elements: null }
      }
    });

    const result = await submitProjectFeedback(
      feedbackOptions(created, 'Linear search', '12345678-1234-4123-8123-123456789abc'),
      commandDependencies
    );

    const types = result.appendedEvents.map(({ type }) => type);
    const shown = result.appendedEvents.filter((event) => event.type === 'visualization.presented');
    expect(shown).toHaveLength(1);
    expect(types.indexOf('assistant.responded')).toBe(types.length - 1);
    expect(types.indexOf('assistant.responded')).toBeGreaterThan(
      types.indexOf('visualization.presented')
    );
    const shownId =
      shown[0].type === 'visualization.presented' && shown[0].payload.presentation.presentationId;
    expect(replies(result.appendedEvents)).toEqual([
      {
        content: [
          { type: 'presentation-ref', presentationId: shownId },
          { type: 'markdown', text: 'is an initial visualisation of linear search.' }
        ],
        question: { text: 'Is the target clear?', presentationId: shownId }
      }
    ]);
  });

  it('shows a changed source’s first comparison with the reply, before building the rest', async () => {
    const choose = vi.fn();
    const { result } = await decide(
      {
        action: 'edit',
        edits: caption,
        comparisons: [views('IntCell', 'IntTally'), marks],
        summary: 'Adds a caption and asks two questions'
      },
      { getChooser: () => chooser(choose), chooserFor: async () => 'model' }
    );

    expect(choose).not.toHaveBeenCalled();
    expect(result.appendedEvents).toContainEqual(
      expect.objectContaining({ type: 'artifact.version-created' })
    );
    const shown = presented(result.appendedEvents);
    expect(shown.map(({ payload }) => payload.question)).toEqual([
      'Cells or tallies for the numbers?',
      'Cells or tallies for the numbers?',
      'Amber or blue marks?',
      'Amber or blue marks?'
    ]);
    // The first pair is built and shown alone; the second is built after it.
    const types = result.appendedEvents.map(({ type }) => type);
    const firstShown = types.indexOf('visualization.presented');
    const builds = types.flatMap((type, index) => (type === 'build.requested' ? [index] : []));
    expect(builds.filter((index) => index < firstShown)).toHaveLength(2);
    expect(builds.filter((index) => index > firstShown)).toHaveLength(2);
    // The reply follows the first pair, before the rest are built.
    const replied = types.indexOf('assistant.responded');
    expect(replied).toBe(firstShown + 2);
    expect(builds.filter((index) => index > replied)).toHaveLength(2);
    const { presentationBufferState, waitingBehind } =
      await import('$lib/shared/projects/presentation-buffer');
    const buffer = presentationBufferState(result.document, 0);
    expect(buffer.available[0].presentationId).toBe(shown[0].payload.presentation.presentationId);
    expect(waitingBehind(buffer, buffer.available[0].presentationId)).toHaveLength(2);
  });

  it('sends a changed source’s comparison naming a value it does not offer back to the assistant', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const document = await createProject(
      { title: 'Unoffered', creation: { templateId: 'linear-search' }, presentationCount: 2 },
      serviceDependencies
    );
    const decision = (action: object) => ({
      ...generation(undefined, 'Asking.'),
      decision: action
    });
    mocks.generatePrepared
      .mockReset()
      // The first pair names it, so it cannot be built.
      .mockResolvedValueOnce(
        decision({
          action: 'edit',
          edits: caption,
          comparisons: [views('IntCell', 'IntDots')],
          summary: 'Adds a caption and asks'
        })
      )
      // A later pair names it, found once the changed source is built.
      .mockResolvedValueOnce(
        decision({
          action: 'vary',
          values: [],
          randomise: [],
          count: null,
          comparisons: [views('IntCell', 'IntTally'), views('IntCell', 'IntDots')],
          summary: 'Asks two questions'
        })
      )
      .mockResolvedValue(generation(undefined, 'Sorry.'));

    const result = await submitProjectFeedback(
      feedbackOptions(document, 'Compare.', '94345678-1234-4123-8123-123456789abc'),
      commandDependencies
    );

    const rejected = result.appendedEvents.filter(
      (event): event is ProjectEventOf<'revision.edits-rejected'> =>
        event.type === 'revision.edits-rejected'
    );
    expect(rejected.slice(0, 2).map(({ payload }) => payload)).toMatchObject([
      { rejected: 'comparisons', problems: [expect.stringMatching(/^Comparison 1 .*IntDots/u)] },
      { rejected: 'comparisons', problems: [expect.stringMatching(/^Comparison 2 .*IntDots/u)] }
    ]);
    expect(presented(result.appendedEvents)).toEqual([]);
  });

  it('sets aside the comparisons an answer makes moot, and asks the assistant once none waits', async () => {
    const { queueProjectPreference } = await import('./commands');
    const { result } = await decide(
      {
        action: 'vary',
        values: [],
        randomise: [],
        count: null,
        comparisons: [views('IntCell', 'IntTally'), marks, views('IntTally', 'IntCell')],
        summary: 'Asks three questions'
      },
      {}
    );
    const ids = presented(result.appendedEvents).map(
      ({ payload }) => payload.presentation.presentationId
    );
    expect(ids).toHaveLength(6);
    const projectId = result.document.projectId;
    const answer = async (left: string, right: string, preferred: string) => {
      const operationId = crypto.randomUUID();
      const head = projectHead(await serviceDependencies.repository.load(projectId)).id;
      await serviceDependencies.repository.append(projectId, head, [
        {
          type: 'operation.accepted',
          actor: { kind: 'user' },
          operationId,
          createdAt: new Date().toISOString(),
          payload: { kind: 'prefer' }
        }
      ]);
      const answered = await queueProjectPreference(
        { projectId, operationId, presentations: [left, right], answer: { preferred }, step: 0 },
        commandDependencies
      );
      return answered.appendedEvents;
    };
    const turnRequested = (events: readonly ProjectEvent[]) =>
      events.some(({ type }) => type === 'assistant.turn-requested');

    // The third question repeats the first, just answered, so it is set aside, and the
    // assistant waits for the marks to be answered.
    const first = await answer(ids[0], ids[1], ids[1]);
    expect(first).toContainEqual(
      expect.objectContaining({
        type: 'visualization.candidates-advanced',
        payload: { presentations: [ids[4], ids[5]], reason: 'moot' }
      })
    );
    expect(turnRequested(first)).toBe(false);
    const { waitingComparisons } = await import('$lib/shared/projects/presentation-buffer');
    expect(
      waitingComparisons(await serviceDependencies.repository.load(projectId)).map(
        ({ question }) => question
      )
    ).toEqual(['Amber or blue marks?']);

    expect(turnRequested(await answer(ids[2], ids[3], ids[2]))).toBe(true);
  });

  it('thinks less on feedback about a drawn source than on a first source', async () => {
    await decide({ action: 'resample', count: null }, {});
    expect(mocks.preparePrompt.mock.calls.at(-1)?.[0]).toMatchObject({ turn: 'feedback' });
    mocks.preparePrompt.mockClear();
    await createComparisonProject('First source');
    expect(mocks.preparePrompt.mock.calls[0]?.[0]).toMatchObject({ turn: 'authoring' });
  });
});

describe('a reply’s text', () => {
  it('leaves long ordinary text as it is, at once', async () => {
    const { withoutLeakedStyles } = await import('./commands');
    const text = 'The preference suggests clearer spacing between the cells. '.repeat(40);
    expect(withoutLeakedStyles([{ type: 'markdown', text }])).toEqual([{ type: 'markdown', text }]);
  });

  it('loses CSS a model leaked at its start, and nothing else', async () => {
    const { withoutLeakedStyles } = await import('./commands');
    expect(
      withoutLeakedStyles([
        { type: 'markdown', text: '.panel{display:none} Lighter borders now.' },
        { type: 'markdown', text: '.a, .b > p { color: red; }' },
        { type: 'markdown', text: 'Use {i} as the index; costs are {a: 1}.' }
      ])
    ).toEqual([
      { type: 'markdown', text: 'Lighter borders now.' },
      { type: 'markdown', text: 'Use {i} as the index; costs are {a: 1}.' }
    ]);
  });
});
