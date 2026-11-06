/** The participant intake before a project's first authoring turn. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { EventId, ParticipantIntakeStepId, ProjectEventOf } from '$lib/shared/projects/events';
import { plainMessageText } from '$lib/shared/projects/events/message-content';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { projectSnapshotAt } from '$lib/shared/projects/projection';
import {
  nextParticipantIntakeStep,
  participantIntakeStep,
  type ParticipantIntakeClassifierOutput
} from '$lib/server/ai/bots/participant-intake';

import { type PreferenceAnswer } from '$lib/server/projects/presentations';
import { currentProjectOperationSignal } from '$lib/server/projects/operation-context';
import { appendProjectEvents, baseOnPresentation, draftEvent } from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import { appendAssistantResponse } from '$lib/server/ai/turns/replies';
import { runPreparedGeneration } from '$lib/server/ai/turns/generation';

/**
 * The assistant builds on the candidate the participant preferred; either is fine and unsure
 * leave the source as it is.
 */
export function basedOnAnswer(
  document: ProjectDocument,
  answer: PreferenceAnswer,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return 'preferred' in answer
    ? baseOnPresentation(document, answer.preferred, operationId, dependencies.projectService)
    : Promise.resolve(document);
}

export type ParticipantIntakeResult = { document: ProjectDocument; author: boolean };

/** Advance the durable blank-project intake before its mode may author output. */
export async function handleParticipantIntake(
  document: ProjectDocument,
  operationId: string,
  feedback: readonly ProjectEventOf<'feedback.submitted'>[],
  dependencies: ProjectCommandDependencies
): Promise<ParticipantIntakeResult> {
  let current = document;
  for (const interaction of feedback.toSorted((left, right) => left.id - right.id)) {
    const activeStep = activeParticipantIntakeStep(current);
    if (!activeStep) return { document: current, author: true };

    // The last question's answer completes intake.
    const next = nextParticipantIntakeStep(activeStep);
    if (!next) {
      current = await completeParticipantIntake(
        current,
        interaction.id,
        'answered',
        operationId,
        dependencies
      );
      return { document: current, author: true };
    }

    const classification = await classifyParticipantIntake(
      current,
      activeStep,
      interaction,
      operationId,
      dependencies
    );
    current = classification.document;
    if (classification.decision === 'exit') {
      current = await completeParticipantIntake(
        current,
        interaction.id,
        'waived',
        operationId,
        dependencies
      );
      return { document: current, author: true };
    }

    current = await appendAssistantResponse(
      current,
      next.question,
      projectSnapshotAt(current).assistantId,
      operationId,
      dependencies,
      [interaction.id],
      { intakeStep: next.id }
    );
  }
  return { document: current, author: activeParticipantIntakeStep(current) === undefined };
}

export function activeParticipantIntakeStep(
  document: ProjectDocument
): ParticipantIntakeStepId | undefined {
  const question = document.events.findLast(
    (event) => event.type === 'assistant.responded' && event.payload.intakeStep !== undefined
  );
  if (question?.type !== 'assistant.responded' || !question.payload.intakeStep) return undefined;
  const completed = document.events.findLast(
    (event) => event.type === 'assistant.intake-completed'
  );
  return completed && completed.id > question.id ? undefined : question.payload.intakeStep;
}

export async function classifyParticipantIntake(
  document: ProjectDocument,
  step: ParticipantIntakeStepId,
  interaction: ProjectEventOf<'feedback.submitted'>,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; decision: 'continue' | 'exit' }> {
  const classifier = dependencies.getParticipantIntakeClassifier();
  const prompt = await classifier.preparePrompt({
    messages: [
      {
        role: 'user',
        content: `Question: ${participantIntakeStep(step).question}\nParticipant response: ${plainMessageText(interaction.payload.content)}`
      }
    ],
    project: {},
    attempt: 1
  });
  const generation = await runPreparedGeneration<ParticipantIntakeClassifierOutput>(
    {
      document,
      attempt: 1,
      operationId,
      prompt,
      generate: () =>
        classifier.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: () => {},
      fallbackResponse: (result) => result,
      notifyFailure: false
    },
    dependencies
  );
  return generation.ok
    ? { document: generation.document, decision: generation.result.decision }
    : { document: generation.document, decision: 'continue' };
}

export function completeParticipantIntake(
  document: ProjectDocument,
  interactionEventId: EventId,
  outcome: 'answered' | 'waived',
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'assistant.intake-completed',
        actor: { kind: 'system' },
        operationId,
        payload: { interactionEventId, outcome }
      })
    ],
    dependencies.projectService
  );
}
