/**
 * Aggregate project event schema and exhaustive dispatch contracts.
 *
 * @packageDocumentation
 */

import * as v from 'valibot';

import {
  aiGenerationFailedEventSchema,
  aiGenerationRequestedEventSchema,
  aiGenerationSucceededEventSchema
} from './ai-generation';
import { artifactVersionCreatedEventSchema } from './artifact-version-created';
import { assistantRespondedEventSchema } from './assistant-responded';
import { assistantIntakeCompletedEventSchema } from './assistant-intake';
import {
  assistantTurnRequestedEventSchema,
  assistantTurnStartedEventSchema
} from './assistant-turn';
import {
  buildFailedEventSchema,
  buildRequestedEventSchema,
  buildSucceededEventSchema
} from './build';
import { feedbackSubmittedEventSchema } from './feedback-submitted';
import {
  operationAcceptedEventSchema,
  operationCompletedEventSchema,
  operationFailedEventSchema
} from './operation-lifecycle';
import { projectCreatedEventSchema } from './project-created';
import { projectRenamedEventSchema } from './project-renamed';
import { revisionEditsRejectedEventSchema } from './revision-edits-rejected';
import { systemNotifiedEventSchema } from './system-notified';
import { visualizationCandidatesAdvancedEventSchema } from './visualization-candidates-advanced';
import { visualizationRuntimeFailedEventSchema } from './visualization-runtime-failed';
import {
  visualizationPreferenceRecordedEventSchema,
  visualizationPresentedEventSchema
} from './visualization-presented';

/** Runtime discriminated union for every immutable project event. */
export const projectEventSchema = v.variant('type', [
  projectCreatedEventSchema,
  operationAcceptedEventSchema,
  operationCompletedEventSchema,
  operationFailedEventSchema,
  projectRenamedEventSchema,
  feedbackSubmittedEventSchema,
  assistantTurnRequestedEventSchema,
  assistantTurnStartedEventSchema,
  assistantIntakeCompletedEventSchema,
  aiGenerationRequestedEventSchema,
  aiGenerationSucceededEventSchema,
  aiGenerationFailedEventSchema,
  buildRequestedEventSchema,
  buildSucceededEventSchema,
  buildFailedEventSchema,
  revisionEditsRejectedEventSchema,
  artifactVersionCreatedEventSchema,
  visualizationPresentedEventSchema,
  visualizationPreferenceRecordedEventSchema,
  visualizationCandidatesAdvancedEventSchema,
  visualizationRuntimeFailedEventSchema,
  assistantRespondedEventSchema,
  systemNotifiedEventSchema
]);

export type { ParticipantIntakeStepId } from './assistant-intake';

export type { ProjectOperationKind } from './operation-lifecycle';

/** Any validated immutable event in a project Timeline. */
export type ProjectEvent = v.InferOutput<typeof projectEventSchema>;
/** Discriminator for a project event. */
export type ProjectEventType = ProjectEvent['type'];
/** Project event narrowed to one discriminator. */
export type ProjectEventOf<Type extends ProjectEventType> = Extract<ProjectEvent, { type: Type }>;
/** Stable one-based position of an event in a project document. */
export type EventId = ProjectEvent['id'];
/** Event payload with its repository-assigned stable ID omitted. */
export type NewProjectEvent<Type extends ProjectEventType = ProjectEventType> = Omit<
  ProjectEventOf<Type>,
  'id'
>;

/** Exhaustive, correctly narrowed handlers for every project event discriminator. */
export type ProjectEventCases<Result, Arguments extends unknown[] = []> = {
  [Type in ProjectEventType]: (event: ProjectEventOf<Type>, ...arguments_: Arguments) => Result;
};

/** Dispatch an event through an exhaustive set of correctly narrowed cases. */
export function matchProjectEvent<Result, Arguments extends unknown[] = []>(
  event: ProjectEvent,
  cases: ProjectEventCases<Result, Arguments>,
  ...arguments_: Arguments
): Result {
  const handler = cases[event.type] as (value: ProjectEvent, ...rest: Arguments) => Result;
  return handler(event, ...arguments_);
}

/** Raised when persisted or incoming project data violates a project schema. */
export class InvalidProjectDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProjectDocumentError';
  }
}

/** Parse and validate one project event. */
export function normalizeProjectEvent(value: unknown): ProjectEvent {
  const parsed = v.safeParse(projectEventSchema, value);
  if (!parsed.success) throw new InvalidProjectDocumentError(v.summarize(parsed.issues));
  return parsed.output;
}
