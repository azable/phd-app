/** Preference commands for compatible retained presentations. */

import type { EventId } from '$lib/shared/projects/events';
import type { MessageContent } from '$lib/shared/projects/events/message-content';
import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import {
  isSverlinPresentation,
  presentationScenarioKey,
  alignPresentationFrames
} from '$lib/shared/presentations';
import { headStillCurrent } from '$lib/shared/projects/projection';

import { runProjectCommand } from './command-lock';
import { projectRepository } from './repository';
import {
  appendProjectEvents,
  defaultProjectServiceDependencies,
  draftEvent,
  type ProjectServiceDependencies
} from './service';

/** Replaceable persistence boundary for presentation-command unit tests. */
export type PresentationCommandDependencies = {
  repository: typeof projectRepository;
  projectService: ProjectServiceDependencies;
};

const defaultDependencies: PresentationCommandDependencies = {
  repository: projectRepository,
  projectService: defaultProjectServiceDependencies
};

/**
 * How a participant answered a comparison: the presentation preferred, or either is fine (tie) or
 * unsure (skip).
 */
export type PreferenceAnswer = { preferred: string } | { outcome: 'tie' | 'skip' };

/** The answer a command gives, which names one preferred presentation or one outcome. */
export function preferenceAnswer(options: {
  preferred?: string;
  outcome?: 'tie' | 'skip';
}): PreferenceAnswer {
  if ((options.preferred === undefined) === (options.outcome === undefined))
    throw new Error('A preference names one preferred presentation or one outcome.');
  return options.preferred !== undefined
    ? { preferred: options.preferred }
    : { outcome: options.outcome! };
}

/** Record a preference between any two compatible retained Sverlin presentations. */
export function recordProjectPreference(
  options: {
    projectId: string;
    expectedHead: EventId;
    presentations: [string, string];
    answer: PreferenceAnswer;
    step: number;
    operationId: string;
  },
  dependencies: PresentationCommandDependencies = defaultDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await checkedDocument(options.projectId, options.expectedHead, dependencies);
    const document = await appendProjectPreference(before, options, dependencies.projectService);
    return { document, appendedEvents: document.events.slice(before.events.length) };
  });
}

/** Validate and append a preference inside a larger already-locked project command. */
export async function appendProjectPreference(
  document: ProjectDocument,
  options: {
    presentations: [string, string];
    answer: PreferenceAnswer;
    step: number;
    operationId: string;
    comment?: MessageContent;
  },
  dependencies: ProjectServiceDependencies
): Promise<ProjectDocument> {
  const supplied = [...new Set(options.presentations)];
  if (
    supplied.length !== 2 ||
    ('preferred' in options.answer && !supplied.includes(options.answer.preferred))
  ) {
    throw new Error('The preference must identify two distinct presentations and one winner.');
  }
  const presented = supplied.map((id) =>
    document.events.find(
      (event) =>
        event.type === 'visualization.presented' && event.payload.presentation.presentationId === id
    )
  );
  if (presented.some((event) => event?.type !== 'visualization.presented')) {
    throw new Error('The preference references an unknown presentation.');
  }
  const [left, right] = presented;
  if (left?.type !== 'visualization.presented' || right?.type !== 'visualization.presented') {
    throw new Error('The preference references an unknown presentation.');
  }
  const leftPresentation = left.payload.presentation;
  const rightPresentation = right.payload.presentation;
  if (
    !isSverlinPresentation(leftPresentation) ||
    !isSverlinPresentation(rightPresentation) ||
    presentationScenarioKey(leftPresentation) !== presentationScenarioKey(rightPresentation)
  ) {
    throw new Error('Only compatible versions of the same visualization can be compared.');
  }
  if (
    options.step < 0 ||
    options.step >= alignPresentationFrames([leftPresentation, rightPresentation]).length
  ) {
    throw new Error('The preference references an unknown presentation step.');
  }
  const displaySetId =
    left.payload.displaySetId === right.payload.displaySetId
      ? left.payload.displaySetId
      : undefined;
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'visualization.preference-recorded',
        actor: { kind: 'user' },
        operationId: options.operationId,
        payload: {
          ...(displaySetId ? { displaySetId } : {}),
          presentations: options.presentations,
          ...options.answer,
          step: options.step,
          ...(options.comment?.length ? { comment: options.comment } : {})
        }
      })
    ],
    dependencies
  );
}

async function checkedDocument(
  projectId: string,
  expectedHead: EventId,
  dependencies: PresentationCommandDependencies
) {
  const document = await dependencies.repository.load(projectId);
  if (!headStillCurrent(document.events, expectedHead)) {
    const error = new Error('The project changed before this operation completed.');
    error.name = 'ProjectConflictError';
    throw error;
  }
  return document;
}
