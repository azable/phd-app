/** The attempt ladder: repairs after a failed attempt, when to stop, and the fallback's recovery note. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { ProjectDocument } from '$lib/shared/projects/model';
import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { cutText } from '$lib/shared/text';
import { modeCatalog } from '$lib/modes/catalog';
import type { GeneratedMessageContent, RecoveryExplanation } from '$lib/server/ai/bots/types';
import type { ChatBotAttemptProfile } from '$lib/server/ai/bots/types';

import { currentProjectOperationDeadline } from '$lib/server/projects/operation-context';
import {
  appendAttemptDeadlineFailure,
  appendWanderingRepairFailure
} from '$lib/server/ai/turns/failures';
import type { AttemptFailure, Problem } from '$lib/server/ai/turns/failures';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';

/**
 * How a mode's build sorts its problems, for the ladder (Sverlin's: sverlinBuildStages in
 * modes/sverlin/assistant/turn.server.ts): the stage of the build that finds each code, in the order
 * it checks, and which failures are slips in the source as written, which take the quick retries.
 */
export type BuildStages = {
  stageOf(code: string | undefined): number | undefined;
  refusedAsWritten(failure: AttemptFailure | undefined): boolean;
};

/** A build that sorts nothing: every failure goes to the slower repairs, and none wanders by stage. */
export const unsortedBuild: BuildStages = {
  stageOf: () => undefined,
  refusedAsWritten: () => false
};

/** The entry artifact's source in a project's newest state. */
export function entrySource(document: ProjectDocument): string {
  const snapshot = projectSnapshotAt(document);
  return snapshot.artifacts[snapshot.entryArtifactId]?.content.text ?? '';
}

/**
 * The attempt after `attempt`: a quick retry only after a source refused as written, else the next
 * attempt that is not one, so the quick retries run one after another straight after the first
 * call and never come back later. Past the ladder's end, its length plus one.
 */
export function nextAttempt(
  profiles: readonly ChatBotAttemptProfile[],
  attempt: number,
  failure?: AttemptFailure,
  stages: BuildStages = unsortedBuild
): number {
  const written = stages.refusedAsWritten(failure);
  let next = attempt + 1;
  while (next <= profiles.length && profiles[next - 1].writtenRetry && !written) next += 1;
  return next;
}

/**
 * Whether a failed repair wandered from the attempt it repaired rather than converging: none of
 * that attempt's problems recur, and new ones appear from the same stage of the build or an earlier
 * one. A repair that still has a problem it was asked to fix is stuck on it, which a higher effort
 * may solve, and is not wandering; nor is one whose new problems all come from a later stage than
 * every problem it fixed, which only passing those let the build find.
 */
export function repairWandered(
  previous: AttemptFailure,
  repair: AttemptFailure,
  stages: BuildStages = unsortedBuild
): boolean {
  const key = ({ code, message }: Problem) => `${code ?? ''}\n${stableMessage(message)}`;
  const before = new Set(previous.diagnostics.map(key));
  if (!repair.diagnostics.length || repair.diagnostics.some((d) => before.has(key(d))))
    return false;
  const fixed = previous.diagnostics.map(({ code }) => stages.stageOf(code));
  const found = repair.diagnostics.map(({ code }) => stages.stageOf(code));
  const reached = fixed.every((stage) => stage !== undefined)
    ? Math.max(...(fixed as number[]))
    : undefined;
  return !(reached !== undefined && found.every((stage) => stage !== undefined && stage > reached));
}

/**
 * A problem's message without the list of what exists that some end with ("…; its kinds of node
 * are A, B.") and without the expressions it quotes ({this.state}), which change whenever the
 * source does, so the same problem is recognised again.
 */
export function stableMessage(message: string): string {
  return message.replace(/;\s+its\b[^;]*?\bare\b[\s\S]*$/, '').replace(/\{[^{}]*\}/gu, '{…}');
}

/**
 * Whether a picture that built can go back for its warnings or its readability after `attempt`:
 * only to a repair, as the attempt after it, never to the fallback.
 */
export function softReturnLeft(
  profiles: readonly ChatBotAttemptProfile[],
  attempt: number
): boolean {
  const after = profiles[nextAttempt(profiles, attempt) - 1];
  return after !== undefined && after.purpose !== 'fallback';
}

/** Whether the project has a version of its own, rather than its mode's starter. */
export function hasWorkingVersion(document: ProjectDocument): boolean {
  return entrySource(document) !== modeCatalog[projectSnapshotAt(document).mode].starter.source;
}

/** Says the last working version was kept, only when there is one. */
export function keptVersion(document: ProjectDocument, joiner = ', so I'): string {
  return hasWorkingVersion(document) ? `${joiner} kept the last working visualization` : '';
}

/** The share of a source's lines, trimmed, that the one it was made from does not have. */
export function sourceRewritten(previous: string, source: string): number {
  const remaining = new Map<string, number>();
  for (const line of previous.split('\n'))
    remaining.set(line.trim(), (remaining.get(line.trim()) ?? 0) + 1);
  const lines = source.split('\n');
  const fresh = lines.filter((line) => {
    const left = remaining.get(line.trim()) ?? 0;
    if (left) remaining.set(line.trim(), left - 1);
    return !left;
  });
  return fresh.length / lines.length;
}

/**
 * Runs attempts until one is done. A ladder whose repairs wander (see repairWandered) is doomed:
 * each fixes what it was told, but the source, too broken to repair one problem at a time, shows
 * a new one, and each higher effort takes longer (a linear search on 2026-11-01 failed four builds
 * so, each with a different problem, the fourth after 97 s). The ladder stops escalating, keeping
 * the current version and saying why, once two repairs have wandered, or one that also rewrote
 * most of the source (more than half its lines new), starting over rather than repairing. One
 * wander is allowed, as fixing a problem often reveals the next, and new problems from a later
 * stage of the build are progress, not wandering (see repairWandered); a repair stuck on the same
 * problem keeps the higher efforts and the fallback. A project with no version of its own yet has
 * nothing to keep, so a doomed ladder there skips to the simpler fallback instead of stopping.
 */
export async function runAttemptLadder(
  document: ProjectDocument,
  operationId: string,
  chatbot: {
    config: { attemptProfiles: readonly ChatBotAttemptProfile[] };
    requestTimeoutMs(): number;
  },
  dependencies: ProjectCommandDependencies,
  runAttempt: (
    document: ProjectDocument,
    attempt: number
  ) => Promise<{ document: ProjectDocument; done: boolean; failure?: AttemptFailure }>,
  stages: BuildStages = unsortedBuild
): Promise<ProjectDocument> {
  const profiles = chatbot.config.attemptProfiles;
  const fallback = profiles.length;
  let previous: AttemptFailure | undefined;
  let wandered = 0;
  for (let attempt = 1; attempt <= fallback; ) {
    if (attempt > 1 && !hasTimeForAnotherAttempt(chatbot)) {
      return appendAttemptDeadlineFailure(document, operationId, dependencies);
    }
    const result = await runAttempt(document, attempt);
    document = result.document;
    if (result.done) return document;
    let next = nextAttempt(profiles, attempt, result.failure, stages);
    if (previous && result.failure && repairWandered(previous, result.failure, stages)) {
      wandered += 1;
      if (wandered >= 2 || sourceRewritten(previous.source, result.failure.source) > 0.5) {
        if (hasWorkingVersion(document) || attempt >= fallback)
          return appendWanderingRepairFailure(document, operationId, dependencies);
        next = fallback;
      }
    }
    previous = result.failure;
    attempt = next;
  }
  throw new Error('The configured attempt ladder ended without a terminal result.');
}

export function hasTimeForAnotherAttempt(chatbot: { requestTimeoutMs(): number }): boolean {
  const deadline = currentProjectOperationDeadline();
  return deadline === undefined || deadline - Date.now() >= chatbot.requestTimeoutMs();
}

export function replyWithRecovery(
  reply: GeneratedMessageContent,
  recovery?: RecoveryExplanation
): GeneratedMessageContent {
  if (!recovery) return reply;
  return [
    {
      type: 'markdown',
      text: `I ran into a difficulty: ${plainFailureSummary(recovery.struggledWith)} To produce a working visualization, I simplified it: ${plainFailureSummary(recovery.simplified)}`
    },
    ...reply
  ];
}

export function participantDiagnostic(diagnostics: readonly { message: string }[]): string {
  return diagnostics.length > 0
    ? 'the generated program still did not satisfy the visualization language checks'
    : 'the visualization builder could not validate the generated source';
}

export function plainFailureSummary(value: string): string {
  const text = cutText(value.replace(/\s+/g, ' ').trim(), 500);
  if (!text) return 'an unspecified validation problem.';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
