import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markdownMessage } from '$lib/shared/projects/events/message-content';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { projectOperations } from '$lib/shared/projects/operations';
import { projectHead } from '$lib/shared/projects/projection';

import { MemoryProjectRepository } from './memory-repository.test-support';
import { currentProjectOperationDeadline } from './operation-context';
import { ProjectOperationExecutor } from './operations';
import type { ProjectRepository } from './repository';

// The executor's real commands, over a repository and an assistant the test controls.
const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as ProjectRepository,
  generatePrepared: vi.fn()
}));

vi.mock('./repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository')>()),
  projectRepository: new Proxy(
    {},
    {
      get: (_target, key) => {
        const value: unknown = Reflect.get(mocks.repository, key);
        return typeof value === 'function' ? value.bind(mocks.repository) : value;
      }
    }
  )
}));

vi.mock('$lib/server/ai/bots/registry', () => {
  const chatbot = {
    config: {
      attemptProfiles: [
        { purpose: 'initial', parameters: { model: 'test-model' } },
        { purpose: 'repair', parameters: { model: 'test-model' } }
      ]
    },
    preparePrompt: async ({ attempt = 1 }: { attempt?: number }) => ({
      initialPrompt: 'html test prompt',
      messages: [],
      context: {},
      attempt: { number: attempt, purpose: attempt === 1 ? 'initial' : 'repair' },
      parameters: { model: 'test-model' },
      responseFormat: { name: 'html-test', schema: {} }
    }),
    generatePrepared: mocks.generatePrepared,
    requestTimeoutMs: () => 1_000
  };
  return {
    assistantIntroduction: (assistantId: string) => ({ botId: assistantId, text: 'Hello.' }),
    getChatbot: () => chatbot,
    getCandidateChatbot: () => chatbot,
    getParticipantIntakeClassifier: () => chatbot
  };
});

// Whether a turn runs the view helpers reads the study from the database, which this test has not.
vi.mock('$lib/server/projects/view-helpers-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/projects/view-helpers-config')>()),
  projectViewHelpers: async () => false
}));

const lock = { acquire: async () => ({ release: async () => undefined }) };

beforeEach(() => {
  mocks.repository = new MemoryProjectRepository();
  mocks.generatePrepared.mockReset();
});

describe('HTML feedback', () => {
  it('returns once queued and runs its turn through the executor, under capacity and deadline', async () => {
    const projectId = await htmlProject();
    let release!: () => void;
    let observedDeadline: number | undefined;
    mocks.generatePrepared.mockImplementation(async () => {
      observedDeadline = currentProjectOperationDeadline();
      await new Promise<void>((resolve) => (release = resolve));
      return htmlGeneration('<main><h1>Done</h1></main>');
    });
    const executor = new ProjectOperationExecutor(mocks.repository, lock, undefined, 1);
    const deadlineAt = new Date(Date.now() + 60_000).toISOString();

    const feedbackId = await submit(executor, projectId, deadlineAt);

    expect(mocks.generatePrepared).not.toHaveBeenCalled();
    expect(operation(await mocks.repository.load(projectId), feedbackId)).toMatchObject({
      status: 'completed'
    });
    await eventually(() => mocks.generatePrepared.mock.calls.length === 1);
    expect(executor.status().active).toBe(1);
    expect(observedDeadline).toBe(Date.parse(deadlineAt));
    const turn = assistantTurn(await mocks.repository.load(projectId));
    expect(turn?.status).toBe('running');

    release();
    await eventually(async () => {
      const document = await mocks.repository.load(projectId);
      return assistantTurn(document)?.status === 'completed';
    });
    const document = await mocks.repository.load(projectId);
    expect(
      document.events.findLast(({ type }) => type === 'visualization.presented')
    ).toMatchObject({
      operationId: turn?.operationId,
      payload: { presentation: { format: 'html-frames-v1' } }
    });
    expect(executor.status().active).toBe(0);
  });

  it('cancels its queued turn when the server shuts down', async () => {
    const projectId = await htmlProject();
    mocks.generatePrepared.mockImplementation(
      (_prompt, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    );
    const executor = new ProjectOperationExecutor(mocks.repository, lock, undefined, 1);

    await submit(executor, projectId);
    await eventually(() => mocks.generatePrepared.mock.calls.length === 1);
    await executor.shutdown(1_000);

    expect(assistantTurn(await mocks.repository.load(projectId))).toMatchObject({
      status: 'failed',
      terminalEvent: { payload: { failureKind: 'cancelled' } }
    });
  });
});

async function htmlProject(): Promise<string> {
  const { createProject } = await import('./service');
  const created = await createProject(
    { creation: { templateId: 'blank', mode: 'html' } },
    { repository: mocks.repository }
  );
  return created.projectId;
}

async function submit(
  executor: ProjectOperationExecutor,
  projectId: string,
  deadlineAt?: string
): Promise<string> {
  const operationId = randomUUID();
  const expectedHead = projectHead(await mocks.repository.load(projectId)).id;
  await executor.accept({
    projectId,
    operationId,
    expectedHead,
    command: {
      type: 'feedback',
      operationId,
      expectedHead,
      content: markdownMessage('Show binary search'),
      focus: [],
      presentationCount: 1
    },
    ...(deadlineAt ? { deadlineAt } : {})
  });
  return operationId;
}

function operation(document: ProjectDocument, operationId: string) {
  return projectOperations(document.events).find((entry) => entry.operationId === operationId);
}

function assistantTurn(document: ProjectDocument) {
  return projectOperations(document.events).findLast(({ kind }) => kind === 'assistant-turn');
}

function htmlGeneration(html: string) {
  return {
    reply: markdownMessage('Created it'),
    candidates: [
      {
        label: 'Candidate',
        manifest: {
          format: 'sverlin-html-frames',
          version: 1,
          frames: [{ label: 'Overview', html }]
        }
      }
    ],
    prompt: {
      initialPrompt: 'html test prompt',
      messages: [],
      context: {},
      parameters: { model: 'test-model' },
      responseFormat: { name: 'html-test', schema: {} }
    },
    generation: { botId: 'html-assistant', adapterId: 'test-adapter', model: 'test-model' }
  };
}

async function eventually(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The expected asynchronous state was not reached.');
}
