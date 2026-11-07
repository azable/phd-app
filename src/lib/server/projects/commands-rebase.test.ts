import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markdownMessage } from '$lib/shared/projects/events/message-content';
import type { ProjectEvent, ProjectEventOf } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';
import type { DesignValues } from '$lib/shared/presentations';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';

import type { ProjectCommandDependencies } from './commands';
import { MemoryProjectRepository } from './memory-repository.test-support';

const mocks = vi.hoisted(() => ({ generatePrepared: vi.fn() }));

vi.mock('$lib/server/ai/bots/registry', () => {
  const chatbot = {
    config: {
      attemptProfiles: [
        { purpose: 'initial', parameters: { model: 'test-model' } },
        { purpose: 'repair', parameters: { model: 'test-model' } }
      ]
    },
    preparePrompt: async ({ attempt = 1 }: { attempt?: number }) => ({
      initialPrompt: 'test prompt',
      messages: [],
      context: {},
      attempt: { number: attempt, purpose: attempt === 1 ? 'initial' : 'repair' },
      parameters: { model: 'test-model' },
      responseFormat: { name: 'test', schema: {} }
    }),
    generatePrepared: mocks.generatePrepared,
    requestTimeoutMs: () => 180_000
  };
  return {
    assistantIntroduction: (assistantId: string) => ({ botId: assistantId, text: 'Hello.' }),
    getChatbot: () => chatbot,
    getCandidateChatbot: () => chatbot,
    getParticipantIntakeClassifier: () => chatbot
  };
});

let repository: MemoryProjectRepository;
let dependencies: ProjectCommandDependencies;

beforeEach(async () => {
  const { defaultProjectCommandDependencies } = await import('./commands');
  repository = new MemoryProjectRepository();
  dependencies = {
    ...defaultProjectCommandDependencies,
    repository,
    projectService: { repository }
  };
  mocks.generatePrepared.mockReset().mockResolvedValue({
    reply: markdownMessage('Got it.'),
    decision: { action: 'respond' },
    prompt: {
      initialPrompt: 'test prompt',
      messages: [],
      context: {},
      parameters: { model: 'test-model' },
      responseFormat: { name: 'test', schema: {} }
    },
    generation: { botId: 'sverlin-assistant', adapterId: 'test-adapter', model: 'test-model' }
  });
});

const cells = { 'views.Int': 'IntCell' };
const tallies = { 'views.Int': 'IntTally' };
const amber = { 'Highlight.<Link>.<To>.fill': 'amber-100' };
const blue = { 'Highlight.<Link>.<To>.fill': 'blue-100' };

describe('changing an earlier answer', () => {
  it('shows the version it went back to, setting aside what it makes moot of the source it left', async () => {
    const projectId = await project();
    const first = await ask(projectId, 'Cells or tallies?', cells, tallies);
    await answer(projectId, first, first[0]);
    await edit(projectId);
    const marks = await ask(projectId, 'Amber or blue?', amber, blue);
    const again = await ask(projectId, 'Tallies or cells?', tallies, cells);

    const changed = await answer(projectId, first, first[1]);

    expect(changed).toContainEqual(
      expect.objectContaining({
        type: 'artifact.version-created',
        payload: expect.objectContaining({
          origin: { kind: 'candidate', presentationId: first[1] }
        })
      })
    );
    // The repeated question, of the source left, is moot; the other is no longer the current
    // source's to wait on.
    expect(changed).toContainEqual(
      expect.objectContaining({
        type: 'visualization.candidates-advanced',
        payload: { presentations: again, reason: 'moot' }
      })
    );
    expect(changed.some(({ type }) => type === 'assistant.turn-requested')).toBe(true);

    const turn = await runTurn(projectId);
    const shown = turn.filter(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented'
    );
    expect(shown).toHaveLength(1);
    const [version] = shown;
    expect(version.payload.question).toBeUndefined();
    const document = await repository.load(projectId);
    const presentation = version.payload.presentation;
    expect(presentation.format === 'browser-bundle-v1' && presentation.source.text).toBe(
      entrySource(document)
    );
    expect(presentation.format === 'browser-bundle-v1' && presentation.variant).toMatchObject(
      tallies
    );
    expect(turn.findLast(({ type }) => type === 'assistant.responded')).toBeDefined();
    expect(marks).toHaveLength(2);
  });

  it('shows the next comparison of the source it went back to, without a model turn', async () => {
    const projectId = await project();
    const first = await ask(projectId, 'Cells or tallies?', cells, tallies);
    await ask(projectId, 'Amber or blue?', amber, blue);
    await answer(projectId, first, first[0]);
    await edit(projectId);
    await ask(projectId, 'Tallies or cells?', tallies, cells);

    const changed = await answer(projectId, first, first[1]);
    expect(changed.some(({ type }) => type === 'assistant.turn-requested')).toBe(true);
    const turn = await runTurn(projectId);

    expect(mocks.generatePrepared).not.toHaveBeenCalled();
    const shown = turn.filter(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented'
    );
    expect(shown.map(({ payload }) => payload.question)).toEqual([
      'Amber or blue?',
      'Amber or blue?'
    ]);
    expect(shown.map(({ payload }) => payload.label)).toEqual(['left', 'right']);
    const document = await repository.load(projectId);
    expect(waitingComparisons(document).map(({ presentationIds }) => presentationIds)).toEqual([
      shown.map(({ payload }) => payload.presentation.presentationId)
    ]);
  });
});

async function project(): Promise<string> {
  const { createProject } = await import('./service');
  const created = await createProject(
    { title: 'Rebase', creation: { templateId: 'linear-search' }, presentationCount: 2 },
    { repository }
  );
  return created.projectId;
}

/** Present a comparison of the current source, as the assistant's comparisons are presented. */
async function ask(
  projectId: string,
  question: string,
  left: DesignValues,
  right: DesignValues
): Promise<[string, string]> {
  const { activateBuiltPresentations, buildProjectSourceBatch } = await import('./service');
  const document = await repository.load(projectId);
  const snapshot = projectSnapshotAt(document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  const recorded = await buildProjectSourceBatch(
    {
      document,
      sourceContent: entry.content.text,
      source: entry.content,
      sourceLabel: entry.path,
      requests: [left, right].map((chosen, index) => ({ seed: index + 1, variant: { chosen } })),
      purpose: 'assistant-edit',
      input: 'committed-artifact',
      operationId: crypto.randomUUID()
    },
    { repository }
  );
  const presented = await activateBuiltPresentations(
    recorded,
    { repository },
    { kind: 'system' },
    { question, labels: ['left', 'right'] }
  );
  const ids = presented.events.slice(-2).map((event) => {
    if (event.type !== 'visualization.presented') throw new Error('Expected a presentation.');
    return event.payload.presentation.presentationId;
  });
  return [ids[0], ids[1]];
}

/** A later version of the source, replacing the one the comparisons were built from. */
async function edit(projectId: string): Promise<void> {
  const { updateProjectArtifact } = await import('./service');
  const document = await repository.load(projectId);
  await updateProjectArtifact(
    {
      projectId,
      expectedHead: projectHead(document).id,
      artifactId: 'main',
      source: `${entrySource(document)}\n<!-- Edited -->`,
      presentationCount: 1,
      operationId: crypto.randomUUID()
    },
    { repository }
  );
}

async function answer(
  projectId: string,
  [left, right]: [string, string],
  preferred: string
): Promise<ProjectEvent[]> {
  const { queueProjectPreference } = await import('./commands');
  const operationId = crypto.randomUUID();
  await operationBoundary(projectId, operationId, 'operation.accepted', 'prefer');
  const answered = await queueProjectPreference(
    { projectId, operationId, presentations: [left, right], answer: { preferred }, step: 0 },
    dependencies
  );
  await operationBoundary(projectId, operationId, 'operation.completed', 'prefer');
  return answered.appendedEvents;
}

/** Run the assistant turn the latest answer asked for. */
async function runTurn(projectId: string): Promise<ProjectEvent[]> {
  const { runQueuedAssistantTurn } = await import('$lib/server/ai/turns/entry');
  const document = await repository.load(projectId);
  const request = document.events.findLast(
    (event): event is ProjectEventOf<'assistant.turn-requested'> =>
      event.type === 'assistant.turn-requested'
  );
  if (!request) throw new Error('Expected a turn request.');
  const operationId = crypto.randomUUID();
  await operationBoundary(projectId, operationId, 'operation.accepted', 'assistant-turn');
  const head = projectHead(await repository.load(projectId)).id;
  await repository.append(projectId, head, [
    {
      type: 'assistant.turn-started',
      actor: { kind: 'system' },
      operationId,
      createdAt: new Date().toISOString(),
      payload: {
        requestEventIds: [request.id],
        interactionEventIds: [request.payload.interactionEventId]
      }
    }
  ]);
  const result = await runQueuedAssistantTurn({ projectId, operationId }, dependencies);
  return result.appendedEvents;
}

async function operationBoundary(
  projectId: string,
  operationId: string,
  type: 'operation.accepted' | 'operation.completed',
  kind: 'prefer' | 'assistant-turn'
): Promise<void> {
  const head = projectHead(await repository.load(projectId)).id;
  await repository.append(projectId, head, [
    {
      type,
      actor: { kind: type === 'operation.accepted' ? 'user' : 'system' },
      operationId,
      createdAt: new Date().toISOString(),
      payload: { kind }
    }
  ]);
}

function entrySource(document: ProjectDocument): string {
  const snapshot = projectSnapshotAt(document);
  return snapshot.artifacts[snapshot.entryArtifactId].content.text;
}
