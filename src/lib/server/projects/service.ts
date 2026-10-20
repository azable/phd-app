/**
 * Server-side project operations and the event-recorded presentation-build lifecycle.
 *
 * @packageDocumentation
 */

import { randomInt, randomUUID } from 'node:crypto';

import { defaultAssistantId } from '$lib/shared/assistants';
import type {
  EventId,
  NewProjectEvent,
  ProjectEventOf,
  ProjectEventType
} from '$lib/shared/projects/events';
import type {
  ArtifactChange,
  ArtifactVersionOrigin,
  RecordedText,
  BuildPurpose
} from '$lib/shared/projects/events/values';
import {
  projectSchemaVersion,
  type ProjectCommandResult,
  type ProjectDocument,
  type ProjectResource
} from '$lib/shared/projects/model';
import { markdownMessage } from '$lib/shared/projects/events/message-content';
import {
  defaultProjectCreation,
  projectCreationMode,
  type ProjectCreation
} from '$lib/shared/projects/creation';
import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import { isSverlinPresentation, presentationMode } from '$lib/shared/presentations';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';
import { assistantIntroduction } from '$lib/server/chat-bots/registry';

import { runProjectCommand } from './command-lock';
import { currentProjectOperationSignal } from './operation-context';
import { recordText } from './fingerprints';
import { projectRepository } from './repository';
import { resolveProjectTemplate } from './starter-catalog';
import { stepSignature } from '$lib/modes/signature.server';
import { modeBuilders, type ModeBuildResult } from '$lib/modes/server';
import { modeCatalog } from '$lib/modes/catalog';

const minSeed = 1;
const maxSeedExclusive = 2147483647;
const entryArtifactId = 'main';
type RecordedBuildBase = {
  document: ProjectDocument;
  source: RecordedText;
  sourceLabel: string;
  seed: number;
  operationId: string;
  buildId: string;
};

/** Build result together with its immutable event and recorded bundle. */
export type RecordedBuild = RecordedBuildBase &
  (
    | {
        result: Extract<ModeBuildResult, { ok: true }>;
        buildEvent: NewProjectEvent<'build.succeeded'>;
        bundle: RecordedText;
      }
    | {
        result: Extract<ModeBuildResult, { ok: false }>;
        buildEvent: NewProjectEvent<'build.failed'>;
      }
  );

/** Options for creating one project from an immutable template. */
type CreateProjectOptions = {
  creation?: ProjectCreation;
  title?: string;
  ownerUserId?: string;
  projectId?: string;
  operationId?: string;
  presentationCount?: 1 | 2;
};

/** Replaceable project-side effects used by database-free domain tests. */
export type ProjectServiceDependencies = {
  repository: typeof projectRepository;
};

export const defaultProjectServiceDependencies: ProjectServiceDependencies = {
  repository: projectRepository
};

/** Create a project, leaving blank conversational templates unbuilt until first use. */
export async function createProject(
  options: CreateProjectOptions = {},
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectDocument> {
  const { document, operationId } = await createProjectSkeleton(options, dependencies);
  if (projectSnapshotAt(document).creation.templateId === 'blank') return document;
  return buildDocument(
    document,
    freshPresentationSeeds(options.presentationCount ?? 1),
    'initial',
    operationId,
    dependencies
  );
}

/** Persist the event-sourced project skeleton before asynchronous presentation building. */
export async function createProjectSkeleton(
  options: CreateProjectOptions = {},
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<{ document: ProjectDocument; operationId: string }> {
  const creation = options.creation ?? defaultProjectCreation;
  const template = resolveProjectTemplate(creation);
  const title = options.title?.trim() || template.title;
  const projectId = options.projectId ?? randomUUID();
  const operationId = options.operationId ?? randomUUID();
  const mode = projectCreationMode(creation);
  const assistantId = defaultAssistantId(mode);
  const root: ProjectEventOf<'project.created'> = {
    id: 1,
    type: 'project.created',
    actor: { kind: 'user' },
    operationId,
    createdAt: new Date().toISOString(),
    payload: { title, entryArtifactId, assistantId, creation }
  };
  const starter = modeCatalog[mode].starter;
  const content = recordText(
    modeCatalog[mode].authoring === 'source' ? template.source : starter.source,
    starter.mediaType
  );
  const artifact: ProjectEventOf<'artifact.version-created'> = {
    id: 2,
    ...draftEvent<'artifact.version-created'>({
      type: 'artifact.version-created',
      actor: { kind: 'system' },
      operationId,
      payload: {
        origin: { kind: 'initial' },
        changes: [
          {
            operation: 'upsert',
            artifact: {
              artifactId: entryArtifactId,
              path: starter.path,
              language: starter.language,
              content
            }
          }
        ]
      }
    })
  };
  const introduction = assistantIntroduction(assistantId);
  const initialEvents: ProjectDocument['events'] = [root, artifact];
  if (creation.templateId === 'blank') {
    initialEvents.push({
      id: 3,
      ...draftEvent<'assistant.responded'>({
        type: 'assistant.responded',
        actor: { kind: 'assistant', botId: introduction.botId },
        operationId,
        payload: {
          content: markdownMessage(introduction.text),
          intakeStep: introduction.step
        }
      })
    });
  }
  const document = await dependencies.repository.create(
    { schemaVersion: projectSchemaVersion, projectId, events: initialEvents },
    options.ownerUserId
  );
  return { document, operationId };
}

/** Load the complete project document and project selector metadata. */
export async function loadProjectResource(
  projectId: string,
  ownerUserId?: string,
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectResource> {
  const document = await dependencies.repository.load(projectId);
  return { document, projects: await dependencies.repository.list(ownerUserId) };
}

/** Build the accepted artifact for an explicit seed or a fresh presentation set. */
export function buildProjectPresentations(
  options: {
    projectId: string;
    expectedHead: EventId;
    operationId: string;
  } & ({ seed: number; purpose: BuildPurpose } | { presentationCount: 1 | 2 }),
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const document = await buildDocument(
      before,
      'seed' in options ? [options.seed] : freshPresentationSeeds(options.presentationCount),
      'seed' in options ? options.purpose : 'seed-change',
      options.operationId,
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Fill the current committed source's configured buffer with fresh seeded presentations. */
export function replenishProjectPresentations(
  options: {
    projectId: string;
    expectedHead: EventId;
    target: number;
    operationId: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    let document = before;
    for (;;) {
      const state = presentationBufferState(document, options.target);
      if (!state.hasCurrentSourcePresentation || state.deficit === 0) break;
      const count = Math.min(2, state.deficit) as 1 | 2;
      const usedSeeds = document.events.flatMap((event) =>
        event.type === 'visualization.presented' &&
        event.payload.presentation.format === 'browser-bundle-v1' &&
        event.payload.presentation.mode === 'sverlin' &&
        event.payload.presentation.source.sha256 === state.sourceSha256
          ? [event.payload.presentation.seed]
          : []
      );
      const next = await buildDocument(
        document,
        freshPresentationSeeds(count, usedSeeds),
        'seed-change',
        options.operationId,
        dependencies
      );
      const nextState = presentationBufferState(next, options.target);
      document = next;
      if (nextState.available.length <= state.available.length) break;
    }
    return commandResult(before, document);
  });
}

/** Consume the currently visible buffered candidates only after an explicit participant action. */
export function advanceProjectPresentations(
  options: {
    projectId: string;
    expectedHead: EventId;
    presentations: string[];
    operationId: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const available = new Set(
      presentationBufferState(before, 0).available.map(({ presentationId }) => presentationId)
    );
    if (
      options.presentations.length === 0 ||
      options.presentations.length > 2 ||
      options.presentations.some((id) => !available.has(id))
    ) {
      throw new Error('Only currently available presentations can be advanced.');
    }
    const document = await appendProjectEvents(
      before,
      [
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'user' },
          operationId: options.operationId,
          payload: { presentations: options.presentations, reason: 'next' }
        })
      ],
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Automatic repairs queued in a row, with no participant interaction between them. */
const maximumAutomaticRepairs = 2;

/**
 * Record that a presentation's view failed as it drew a step in the participant's browser, once
 * per presentation and message, so the assistant sees it and can fix the view. A failure of the
 * current source also queues an assistant turn to repair it, once per source and at most
 * maximumAutomaticRepairs times in a row, so a view that keeps failing waits for the participant.
 */
export function reportRuntimeFailure(
  options: {
    projectId: string;
    expectedHead: EventId;
    operationId: string;
    presentationId: string;
    step?: number;
    message: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const presented = before.events.find(
      (event) =>
        event.type === 'visualization.presented' &&
        event.payload.presentation.presentationId === options.presentationId
    );
    if (presented?.type !== 'visualization.presented') {
      throw new Error('Only a presented visualization can report a failure.');
    }
    const known = before.events.some(
      (event) =>
        event.type === 'visualization.runtime-failed' &&
        event.payload.presentationId === options.presentationId &&
        event.payload.message === options.message
    );
    if (known) return commandResult(before, before);
    const failureEventId = projectHead(before).id + 1;
    const document = await appendProjectEvents(
      before,
      [
        draftEvent({
          type: 'visualization.runtime-failed',
          actor: { kind: 'system' },
          operationId: options.operationId,
          payload: {
            presentationId: options.presentationId,
            message: options.message,
            ...(options.step === undefined ? {} : { step: options.step })
          }
        }),
        ...(repairsAutomatically(before, presented.payload.presentation)
          ? [
              draftEvent({
                type: 'assistant.turn-requested',
                actor: { kind: 'system' },
                operationId: options.operationId,
                payload: { interactionEventId: failureEventId, presentationCount: 1 }
              })
            ]
          : [])
      ],
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Whether a failure of this presentation queues a repair, as reportRuntimeFailure describes. */
function repairsAutomatically(
  document: ProjectDocument,
  presentation: ProjectEventOf<'visualization.presented'>['payload']['presentation']
): boolean {
  const snapshot = projectSnapshotAt(document);
  const current = snapshot.artifacts[snapshot.entryArtifactId]?.content.sha256;
  if (!isSverlinPresentation(presentation) || presentation.source.sha256 !== current) {
    return false;
  }
  const sources = new Map(
    document.events.flatMap((event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1'
        ? [[event.payload.presentation.presentationId, event.payload.presentation.source.sha256]]
        : []
    )
  );
  let repairs = 0;
  for (const event of document.events.toReversed()) {
    if (event.type === 'feedback.submitted' || event.type === 'visualization.preference-recorded') {
      break;
    }
    if (event.type !== 'assistant.turn-requested') continue;
    const failure = document.events[event.payload.interactionEventId - 1];
    if (failure?.type !== 'visualization.runtime-failed') continue;
    if (sources.get(failure.payload.presentationId) === current) return false;
    repairs += 1;
  }
  return repairs < maximumAutomaticRepairs;
}

/** Append a user-authored project title change. */
export function renameProject(
  options: {
    projectId: string;
    expectedHead: EventId;
    title: string;
    operationId: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const snapshot = projectSnapshotAt(before);
    const title = options.title.trim();
    if (!title) throw new Error('Project title cannot be empty.');
    if (title === snapshot.title) return commandResult(before, before);
    const document = await appendProjectEvents(
      before,
      [
        draftEvent({
          type: 'project.renamed',
          actor: { kind: 'user' },
          operationId: options.operationId,
          payload: { previousTitle: snapshot.title, title }
        })
      ],
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Save a manual artifact version and build its presentations. */
export function updateProjectArtifact(
  options: {
    projectId: string;
    expectedHead: EventId;
    artifactId: string;
    source: string;
    presentationCount: 1 | 2;
    operationId: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const snapshot = projectSnapshotAt(before);
    const current = snapshot.artifacts[options.artifactId];
    if (!current) throw new Error(`Unknown artifact ${options.artifactId}.`);
    if (modeCatalog[snapshot.mode].authoring === 'candidates') {
      const builder = modeBuilders[snapshot.mode].buildPresentation;
      if (!builder) throw new Error(`Mode ${snapshot.mode} has no presentation builder.`);
      await builder(options.source, 1);
    }
    const content = recordText(options.source, current.content.mediaType);
    let document = await appendProjectEvents(
      before,
      [
        artifactVersionEvent({
          operationId: options.operationId,
          origin: { kind: 'manual-edit' },
          changes: [{ operation: 'upsert', artifact: { ...current, content } }]
        })
      ],
      dependencies
    );
    document = await buildDocument(
      document,
      freshPresentationSeeds(options.presentationCount),
      'manual-edit',
      options.operationId,
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Copy historical artifacts forward and build them as a new project state. */
export function restoreProjectArtifacts(
  options: {
    projectId: string;
    expectedHead: EventId;
    from: EventId;
    seed: number;
    operationId: string;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const current = projectSnapshotAt(before);
    const historical = projectSnapshotAt(before, options.from);
    const changes: ArtifactChange[] = [
      ...Object.values(historical.artifacts).map(
        (artifact): ArtifactChange => ({ operation: 'upsert', artifact })
      ),
      ...Object.keys(current.artifacts)
        .filter((artifactId) => !(artifactId in historical.artifacts))
        .map((artifactId): ArtifactChange => ({ operation: 'delete', artifactId }))
    ];
    let document = await appendProjectEvents(
      before,
      [
        artifactVersionEvent({
          operationId: options.operationId,
          origin: { kind: 'restore', restoredFrom: options.from },
          changes
        })
      ],
      dependencies
    );
    document = await buildDocument(
      document,
      [options.seed],
      'restore',
      options.operationId,
      dependencies
    );
    return commandResult(before, document);
  });
}

/** Atomically append events to the supplied document's current head. */
export async function appendProjectEvents(
  document: ProjectDocument,
  events: NewProjectEvent[],
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<ProjectDocument> {
  return (
    await dependencies.repository.append(document.projectId, projectHead(document).id, events)
  ).document;
}

/** Add a creation timestamp to a typed event before repository insertion. */
export function draftEvent<Type extends ProjectEventType>(
  event: Omit<NewProjectEvent<Type>, 'createdAt'>
): NewProjectEvent<Type> {
  return { ...event, createdAt: new Date().toISOString() } as NewProjectEvent<Type>;
}

async function buildDocument(
  document: ProjectDocument,
  seeds: readonly number[],
  purpose: BuildPurpose,
  operationId: string,
  dependencies: ProjectServiceDependencies
) {
  const snapshot = projectSnapshotAt(document);
  const artifact = snapshot.artifacts[snapshot.entryArtifactId];
  if (!artifact) throw new Error('The project has no entry artifact.');
  if (modeCatalog[snapshot.mode].authoring === 'candidates') {
    const builder = modeBuilders[snapshot.mode].buildPresentation;
    if (!builder) throw new Error(`Mode ${snapshot.mode} has no presentation builder.`);
    const presentation = await builder(artifact.content.text, seeds[0] ?? 1);
    if (presentationMode(presentation) !== snapshot.mode)
      throw new Error('The mode builder returned a presentation for a different mode.');
    return appendProjectEvents(
      document,
      [
        draftEvent({
          type: 'visualization.presented',
          actor: { kind: 'system' },
          operationId,
          payload: { displaySetId: randomUUID(), slot: 0, presentation }
        })
      ],
      dependencies
    );
  }
  if (seeds.length === 0) throw new Error('At least one seed is required.');
  const recorded = await buildProjectSourceBatch(
    {
      document,
      sourceContent: artifact.content.text,
      source: artifact.content,
      sourceLabel: artifact.path,
      seeds,
      purpose,
      input: 'committed-artifact',
      operationId
    },
    dependencies
  );
  return recorded.builds.every(({ result }) => result.ok)
    ? activateBuiltPresentations(recorded, dependencies)
    : recorded.document;
}

export type RecordedBuildBatch = {
  document: ProjectDocument;
  builds: RecordedBuild[];
};

/** Build one component for several seeds and record each requested presentation. */
export async function buildProjectSourceBatch(
  options: {
    document: ProjectDocument;
    sourceContent: string;
    source: RecordedText;
    sourceLabel: string;
    seeds: readonly number[];
    purpose: BuildPurpose;
    input: 'committed-artifact' | 'assistant-candidate';
    operationId: string;
    attempt?: number;
  },
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies
): Promise<RecordedBuildBatch> {
  if (options.seeds.length === 0) throw new Error('At least one seed is required.');
  const mode = projectSnapshotAt(options.document).mode;
  if (options.sourceLabel !== modeCatalog[mode].starter.path)
    throw new Error(`Mode ${mode} has an unexpected source artifact.`);
  const builder = modeBuilders[mode].buildBatch;
  if (!builder) throw new Error(`Mode ${mode} has no source builder.`);
  const buildId = randomUUID();
  const requests = options.seeds.map((seed, batchIndex) =>
    draftEvent<'build.requested'>({
      type: 'build.requested',
      actor: { kind: 'system' },
      operationId: options.operationId,
      payload: {
        purpose: options.purpose,
        input: options.input,
        source: options.source,
        sourceLabel: options.sourceLabel,
        seed,
        buildId,
        batchIndex,
        batchSize: options.seeds.length,
        ...(options.attempt ? { attempt: options.attempt } : {})
      }
    })
  );
  let document = await appendProjectEvents(options.document, requests, dependencies);
  const results = await builder(
    options.sourceContent,
    options.seeds,
    currentProjectOperationSignal()
  );
  if (
    results.some(
      (result) => result.ok && (result.bundle.mode !== mode || !modeCatalog[mode].scriptedPlayback)
    )
  ) {
    throw new Error('The mode builder returned a bundle for a different playback contract.');
  }
  if (results.length !== options.seeds.length) {
    throw new Error('The visualization service returned an incomplete batch.');
  }
  if (results.some((result, index) => result.seed !== options.seeds[index])) {
    throw new Error('The visualization service returned an incorrectly correlated batch.');
  }
  const builds: RecordedBuild[] = [];
  for (const [index, result] of results.entries()) {
    const recorded = await recordBuildResult(
      {
        document,
        result,
        source: options.source,
        sourceLabel: options.sourceLabel,
        seed: options.seeds[index],
        operationId: options.operationId,
        buildId,
        batchIndex: index,
        batchSize: options.seeds.length
      },
      dependencies
    );
    document = recorded.document;
    builds.push(recorded);
  }
  return { document, builds };
}

async function recordBuildResult(
  options: {
    document: ProjectDocument;
    result: ModeBuildResult;
    source: RecordedText;
    sourceLabel: string;
    seed: number;
    operationId: string;
    buildId: string;
    batchIndex: number;
    batchSize: number;
  },
  dependencies: ProjectServiceDependencies
): Promise<RecordedBuild> {
  if (!options.result.ok) {
    const buildEvent = draftEvent<'build.failed'>({
      type: 'build.failed',
      actor: { kind: 'system' },
      operationId: options.operationId,
      payload: {
        durationMs: options.result.durationMs,
        buildId: options.buildId,
        seed: options.seed,
        batchIndex: options.batchIndex,
        batchSize: options.batchSize,
        failureKind: options.result.failureKind,
        diagnostics: options.result.diagnostics,
        repairEligible: options.result.failureKind === 'source',
        error: options.result.error
      }
    });
    return {
      document: await appendProjectEvents(options.document, [buildEvent], dependencies),
      result: options.result,
      buildEvent,
      source: options.source,
      sourceLabel: options.sourceLabel,
      seed: options.seed,
      operationId: options.operationId,
      buildId: options.buildId
    };
  }

  const bundle = recordText(JSON.stringify(options.result.bundle), 'application/json');
  const buildEvent = draftEvent<'build.succeeded'>({
    type: 'build.succeeded',
    actor: { kind: 'system' },
    operationId: options.operationId,
    payload: {
      durationMs: options.result.durationMs,
      buildId: options.buildId,
      seed: options.seed,
      batchIndex: options.batchIndex,
      batchSize: options.batchSize,
      bundle
    }
  });
  return {
    document: await appendProjectEvents(options.document, [buildEvent], dependencies),
    result: options.result,
    buildEvent,
    bundle,
    source: options.source,
    sourceLabel: options.sourceLabel,
    seed: options.seed,
    operationId: options.operationId,
    buildId: options.buildId
  };
}

/** Promote a complete successful batch to one synchronized active display set. */
export async function activateBuiltPresentations(
  recorded: RecordedBuildBatch,
  dependencies: ProjectServiceDependencies = defaultProjectServiceDependencies,
  actor: NewProjectEvent<'visualization.presented'>['actor'] = { kind: 'system' }
): Promise<ProjectDocument> {
  if (recorded.builds.length === 0 || recorded.builds.some((item) => !item.result.ok)) {
    throw new Error('Only a complete successful build batch can be presented.');
  }
  if (recorded.builds.length > 2) {
    throw new Error('A display set supports at most two presentations.');
  }
  const presentations = recorded.builds.map((item): BrowserBundlePresentation => {
    if (!item.result.ok || !('bundle' in item)) {
      throw new Error('A failed build cannot become a presentation.');
    }
    const { bundle } = item.result;
    return {
      presentationId: randomUUID(),
      format: 'browser-bundle-v1',
      mode: bundle.mode,
      // Presentations of one master trace share a signature even when they keep different steps.
      stepSignature: bundle.masterSignature ?? stepSignature(bundle.labels),
      labels: bundle.labels,
      ...(bundle.masterSteps ? { masterSteps: bundle.masterSteps } : {}),
      ...(bundle.parameters ? { parameters: bundle.parameters } : {}),
      ...(bundle.draws ? { draws: bundle.draws } : {}),
      seed: item.seed,
      source: item.source,
      html: recordText(bundle.html, 'text/html'),
      javascript: recordText(bundle.javascript, 'text/javascript')
    };
  });
  if (new Set(presentations.map(({ stepSignature }) => stepSignature)).size !== 1) {
    throw new Error('Synchronized presentations must come from the same scenario.');
  }
  const displaySetId = randomUUID();
  const operationId = recorded.builds[0].operationId;
  return appendProjectEvents(
    recorded.document,
    presentations.map((presentation, slot) =>
      draftEvent({
        type: 'visualization.presented',
        actor,
        operationId,
        payload: { displaySetId, slot: slot as 0 | 1, presentation }
      })
    ),
    dependencies
  );
}

function artifactVersionEvent(options: {
  operationId: string;
  origin: ArtifactVersionOrigin;
  changes: ArtifactChange[];
}) {
  return draftEvent({
    type: 'artifact.version-created',
    actor:
      options.origin.kind === 'assistant-edit'
        ? { kind: 'assistant', botId: 'sverlin-assistant' }
        : { kind: 'user' },
    operationId: options.operationId,
    payload: { origin: options.origin, changes: options.changes }
  });
}

/** Choose distinct positive seeds for one server-owned presentation generation. */
export function freshPresentationSeeds(count: 1 | 2, excluded: readonly number[] = []): number[] {
  const blocked = new Set(excluded);
  const seeds: number[] = [];
  while (seeds.length < count) {
    const seed = randomInt(minSeed, maxSeedExclusive);
    if (!blocked.has(seed) && !seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

function commandResult(before: ProjectDocument, document: ProjectDocument): ProjectCommandResult {
  return { document, appendedEvents: document.events.slice(before.events.length) };
}

async function checkedDocument(
  projectId: string,
  expectedHead: EventId,
  dependencies: ProjectServiceDependencies
) {
  const document = await dependencies.repository.load(projectId);
  if (projectHead(document).id !== expectedHead) {
    const error = new Error('The project changed before this operation completed.');
    error.name = 'ProjectConflictError';
    throw error;
  }
  return document;
}
