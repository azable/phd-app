import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import {
  markdownMessage,
  type ElementReference
} from '$lib/shared/projects/events/message-content';
import type { ProjectEventOf } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';
import type { BrowserBundlePresentation } from '$lib/shared/presentations';

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
    const first = await reportRuntimeFailure(
      { ...failure, expectedHead: projectHead(created).id, operationId: crypto.randomUUID() },
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
      { payload: { interactionEventId: recorded[0].id, presentationCount: 1 } }
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
      generation('valid intake source', 'I am preparing two distinct options.')
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
    ).toHaveLength(2);
  });

  it('finishes an intake begun with questions no longer asked on its next answer', async () => {
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Earlier intake' }, serviceDependencies);
    const document = await withActiveIntake(created, 'audience');
    mocks.preparePrompt.mockImplementation(async () => generationPrompt('initial'));
    mocks.generatePrepared.mockResolvedValue(generation('valid earlier source', 'Starting now.'));

    const result = await submitProjectFeedback(
      feedbackOptions(document, 'First-year students', '12345678-1234-4123-8123-123456789a02'),
      commandDependencies
    );

    expect(result.appendedEvents).toContainEqual(
      expect.objectContaining({
        type: 'assistant.intake-completed',
        payload: expect.objectContaining({ outcome: 'answered' })
      })
    );
    expect(result.appendedEvents.some(({ type }) => type === 'visualization.presented')).toBe(true);
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
    const withStyle = await serviceDependencies.repository.append(
      created.projectId,
      projectHead(created).id,
      [
        {
          type: 'assistant.responded',
          actor: { kind: 'assistant', botId: 'html-assistant' },
          operationId: feedbackOperationId,
          createdAt: new Date().toISOString(),
          payload: { content: markdownMessage('Which visual style?'), intakeStep: 'style' }
        }
      ]
    );
    const head = projectHead(withStyle.document).id;
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
      action: 'resample',
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
      action: 'resample',
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

  it('builds a synchronized comparison from two distinct fresh seeds', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue(generation('valid source', 'Ready'));
    const { createProject } = await import('./service');
    const { submitProjectFeedback } = await import('./commands');
    const created = await createProject({ title: 'Comparison' }, serviceDependencies);

    const result = await submitProjectFeedback(
      {
        projectId: created.projectId,
        expectedHead: projectHead(created).id,
        content: markdownMessage('Show two alternatives'),
        focus: [],
        presentationCount: 2,
        operationId: '12345678-1234-4123-8123-123456789abc'
      },
      commandDependencies
    );

    const buildRequests = result.appendedEvents.filter((event) => event.type === 'build.requested');
    expect(new Set(buildRequests.map(({ payload }) => payload.seed)).size).toBe(2);
    const presented = result.appendedEvents.filter(
      (event) => event.type === 'visualization.presented'
    );
    expect(presented).toHaveLength(2);
    expect(new Set(presented.map(({ payload }) => payload.displaySetId)).size).toBe(1);
    expect(new Set(presented.map(({ payload }) => payload.presentation.presentationId)).size).toBe(
      2
    );
    const buildResults = result.appendedEvents.filter((event) => event.type === 'build.succeeded');
    expect(buildRequests).toHaveLength(2);
    expect(buildResults).toHaveLength(2);
    expect(
      new Set([
        ...buildRequests.map(({ payload }) => payload.buildId),
        ...buildResults.map(({ payload }) => payload.buildId)
      ]).size
    ).toBe(1);
    expect(
      buildResults.every(({ payload }) => payload.bundle.mediaType === 'application/json')
    ).toBe(true);
  });

  it('repairs a failed component batch using the same two seeds', async () => {
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
    expect(requests.map(({ payload }) => payload.seed).slice(0, 2)).toEqual(
      requests.map(({ payload }) => payload.seed).slice(2)
    );
    expect(
      result.appendedEvents.filter((event) => event.type === 'visualization.presented')
    ).toHaveLength(2);
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
    expect(result.appendedEvents.at(-1)).toMatchObject({
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
        preferred: comparison.presentations[0].payload.presentation.presentationId,
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

  it('proactively builds a revised pair when preference evidence is sufficient', async () => {
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
        preferred: comparison.presentations[1].payload.presentation.presentationId,
        step: 0,
        operationId: '12345678-1234-4123-8123-123456789abe'
      },
      commandDependencies
    );

    expect(
      result.appendedEvents.filter(({ type }) => type === 'visualization.presented')
    ).toHaveLength(2);
    expect(result.appendedEvents).toContainEqual(
      expect.objectContaining({ type: 'artifact.version-created' })
    );
    const observationIndex = result.appendedEvents.findIndex(
      ({ type }) => type === 'assistant.responded'
    );
    const buildIndex = result.appendedEvents.findIndex(({ type }) => type === 'build.requested');
    expect(observationIndex).toBeGreaterThanOrEqual(0);
    expect(observationIndex).toBeLessThan(buildIndex);
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
      action: 'respond',
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
      action: 'respond',
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
      action: 'respond',
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
      action: 'respond',
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
      action: 'respond',
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

  it('traces a referenced element to its node in the presentation source for the assistant', async () => {
    mocks.generatePrepared.mockReset().mockResolvedValue({
      reply: markdownMessage('Noted.'),
      action: 'respond',
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
    const line = lines.findIndex((text) => text.startsWith('<Node size={titleSize}')) + 1;
    const reference: ElementReference = {
      type: 'element-ref',
      presentationId: presentation.presentationId,
      step: 1,
      element: {
        id: `${line}:1`,
        label: 'Linear search',
        layouts: [{ node: `${line}:1`, seed: 7, form: 'snake' }]
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
                elementId: `${line}:1`,
                label: 'Linear search',
                source: expect.objectContaining({
                  line,
                  column: 1,
                  occurrence: 1,
                  markup: expect.stringContaining('Linear search')
                }),
                layouts: [
                  {
                    node: `${line}:1`,
                    seed: 7,
                    form: 'snake',
                    source: expect.objectContaining({ line, column: 1 })
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
  sourceArtifactContent: string | undefined,
  reply: string,
  recovery?: { struggledWith: string; simplified: string }
) {
  return {
    reply: markdownMessage(reply),
    action: sourceArtifactContent === undefined ? ('respond' as const) : ('revise' as const),
    sourceArtifactContent:
      sourceArtifactContent === undefined
        ? undefined
        : sourceArtifactContent.startsWith('broken')
          ? '<script>import unavailable from "elsewhere";</script><h1>Broken</h1>'
          : `<script lang="sverlin">yield;</script><Node>${sourceArtifactContent}</Node>`,
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
  intakeStep: 'algorithm' | 'audience' | 'style'
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
    .mockResolvedValue(generation('valid comparison source', 'Compare these candidates.'));
  const result = await submitProjectFeedback(
    {
      projectId: created.projectId,
      expectedHead: projectHead(created).id,
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
        source: `${earlier.source.text}\n<Node>Edited</Node>`,
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
          source: `${source}\n<Node>${operationId.slice(0, 2)}</Node>`,
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
    action: 'edit' as const,
    edits,
    summary
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
    mocks.generatePrepared
      .mockReset()
      .mockResolvedValue(
        edit([{ find: source, replace: `${source}\n<Node>Caption</Node>` }], 'Adds a caption')
      );

    const result = await feedback(document);

    const revised = version(result.document);
    expect(revised?.payload).toMatchObject({
      origin: { kind: 'assistant-edit' },
      summary: 'Adds a caption'
    });
    const [change] = revised?.payload.changes ?? [];
    expect(change?.operation === 'upsert' && change.artifact.content.text).toBe(
      `${source}\n<Node>Caption</Node>`
    );
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
    const [change] = version(result.document)?.payload.changes ?? [];
    expect(change?.operation === 'upsert' && change.artifact.content.text).toContain('Corrected');
  });
});
