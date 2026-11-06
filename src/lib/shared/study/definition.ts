/** Pure, versioned research-study definitions and resolution helpers. */

import type {
  PresentationLayout,
  VisualizationMode,
  WorkspaceView
} from '$lib/shared/presentations';
import type { StudyInteractionCapturePolicy } from './interactions';

export type HelperCounts = { views: number; layouts: number };

/**
 * A round's helpers, each trying a direction of its own: up to five ways to draw a value, and up to
 * ten arrangements of a page, which differ more. Their builds share one time budget, and only the
 * best few reach the assistant (modes/sverlin/assistant/helpers/context.server.ts), so more helpers add cost, not waiting.
 */
export const defaultHelperCounts: HelperCounts = { views: 5, layouts: 8 };

export type StudyCondition = {
  mode: VisualizationMode;
  presentationBufferTarget?: number;
  /** No longer used: kept so that stored definitions naming a chooser still read. */
  chooser?: string;
  /** Whether short parallel calls propose alternative views for the assistant; on when absent. */
  viewHelpers?: boolean;
  /** How many helpers a round of view or layout helpers runs; defaultHelperCounts when absent. */
  helperCounts?: HelperCounts;
  workspace: {
    view: WorkspaceView;
    layout: PresentationLayout;
  };
  project: {
    templateId: string;
  };
  durationSeconds: number;
};

export type StudyPhase =
  | {
      id: string;
      kind: 'instruction';
      title: string;
      paragraphs: string[];
      continueLabel: string;
    }
  | {
      id: string;
      kind: 'task';
      conditionSlot: string;
      allowEarlyCompletion?: boolean;
      instructions: { title: string; prompt: string };
    }
  | { id: string; kind: 'completion'; title: string; paragraphs: string[] };

export type StudyDefinition = {
  id: string;
  version: number;
  name: string;
  description: string;
  assignment: { strategy: 'balanced'; tieBreakOrder: string[] };
  interactionCapture?: StudyInteractionCapturePolicy;
  conditions: Record<string, StudyCondition>;
  arms: Record<string, { slots: Record<string, string> }>;
  flow: StudyPhase[];
};

export type ResolvedStudyPhase =
  | Exclude<StudyPhase, { kind: 'task' }>
  | (Extract<StudyPhase, { kind: 'task' }> & {
      conditionId: string;
      condition: StudyCondition;
    });

/** Convert minutes to the seconds stored by server-authoritative task timers. */
export function minutes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Minutes must be positive.');
  return value * 60;
}

/** Validate and freeze a study protocol before it is registered. */
export function defineStudy<const Definition extends StudyDefinition>(
  definition: Definition
): Readonly<Definition> {
  if (!definition.flow.length) throw new Error('Study protocols need at least one phase.');
  if (definition.flow[0]?.kind !== 'instruction') {
    throw new Error('Study protocols must begin with an instruction phase.');
  }
  if (definition.flow.at(-1)?.kind !== 'completion') {
    throw new Error('Study protocols must end with a completion phase.');
  }
  if (definition.flow.slice(0, -1).some(({ kind }) => kind === 'completion')) {
    throw new Error('Study completion must be the final phase.');
  }
  const phaseIds = definition.flow.map(({ id }) => id);
  if (new Set(phaseIds).size !== phaseIds.length)
    throw new Error('Study phase IDs must be unique.');
  if (!Number.isSafeInteger(definition.version) || definition.version <= 0) {
    throw new Error('Study versions must be positive integers.');
  }
  if (!definition.assignment.tieBreakOrder.length) {
    throw new Error('Study protocols need at least one assignment arm.');
  }
  if (definition.interactionCapture) {
    const capture = definition.interactionCapture;
    if (capture.cursorChunkDurationMs < capture.cursorSampleIntervalMs) {
      throw new Error('Study interaction cursor chunks must contain at least one sample.');
    }
    if (capture.flushByteThreshold > capture.outboxByteLimit) {
      throw new Error('Study interaction flush bytes cannot exceed the local outbox limit.');
    }
  }
  for (const [id, condition] of Object.entries(definition.conditions)) {
    if (!Number.isSafeInteger(condition.durationSeconds) || condition.durationSeconds <= 0) {
      throw new Error(`Study condition ${id} needs a positive duration.`);
    }
    if (
      condition.presentationBufferTarget !== undefined &&
      (!Number.isSafeInteger(condition.presentationBufferTarget) ||
        condition.presentationBufferTarget < (condition.workspace.layout === 'comparison' ? 2 : 1))
    ) {
      throw new Error(
        `Study condition ${id} needs a presentation buffer large enough for its workspace layout.`
      );
    }
  }
  for (const armId of definition.assignment.tieBreakOrder) {
    if (!definition.arms[armId]) throw new Error(`Unknown study arm ${armId}.`);
  }
  for (const [armId, arm] of Object.entries(definition.arms)) {
    for (const phase of definition.flow) {
      if (phase.kind !== 'task') continue;
      const conditionId = arm.slots[phase.conditionSlot];
      if (!conditionId || !definition.conditions[conditionId]) {
        throw new Error(`Study arm ${armId} does not resolve slot ${phase.conditionSlot}.`);
      }
    }
  }
  return Object.freeze(definition);
}

/** Resolve one counterbalanced arm into the exact phase sequence a participant receives. */
export function resolveStudyArm(definition: StudyDefinition, armId: string): ResolvedStudyPhase[] {
  const arm = definition.arms[armId];
  if (!arm) throw new Error(`Unknown study arm ${armId}.`);
  return definition.flow.map((phase) => {
    if (phase.kind !== 'task') return phase;
    const conditionId = arm.slots[phase.conditionSlot];
    const condition = definition.conditions[conditionId];
    if (!condition) throw new Error(`Unknown study condition ${conditionId}.`);
    return { ...phase, conditionId, condition };
  });
}
