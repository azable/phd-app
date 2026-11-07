/**
 * How often each build warning code occurs across projects, for refining the assistants' contexts:
 * each version counted once, by its source, and each warning attributed to the generation that
 * wrote that version (its purpose, model and request event, which holds the prompt). Only built
 * versions are read, the presentations shown and the candidates sent back for their warnings, never
 * the contexts of later turns, which list earlier presentations' warnings again.
 */

import { presentationWarningCode, type PresentationWarning } from '$lib/shared/presentations';
import type { ProjectEvent } from '$lib/shared/projects/events';

/** Purposes of calls that write no version: a helper's fill is built as a pick, apart. */
const unversioned = new Set(['helper', 'scoring', 'choosing']);

export type WarningOccurrence = {
  projectId: string;
  code: string;
  /** The event that showed the version, or that sent it back. */
  eventId: number;
  sourceSha256?: string;
  /**
   * What wrote it: a generation's purpose (initial, repair, …); a helper's fill picked into the
   * source, `helper-pick`, with the model of the round's helpers; else the build's purpose.
   */
  purpose: string;
  model?: string;
  reasoningEffort?: string;
  attempt?: number;
  /** The generation request, which holds the prompt the version was written from. */
  generationRequestEventId?: number;
  sentBack: boolean;
};

export type WarningCodeSummary = {
  occurrences: number;
  projects: number;
  byModel: Record<string, number>;
  byPurpose: Record<string, number>;
  /** Versions sent back to the assistant for this warning, and of those, the next lacking it. */
  sentBack: number;
  fixedNext: number;
};

export type WarningSummary = {
  versions: number;
  codes: Record<string, WarningCodeSummary>;
  occurrences: WarningOccurrence[];
};

type Generation = {
  purpose: string;
  model?: string;
  reasoningEffort?: string;
  attempt: number;
  eventId: number;
};

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The warnings of one project's versions, each version once, attributed. */
export function projectWarnings(
  projectId: string,
  events: readonly ProjectEvent[]
): { versions: number; occurrences: WarningOccurrence[]; fixed: Map<string, number> } {
  const generations = new Map<string, Generation>();
  const builds = new Map<string, { attempt?: number; purpose: string }>();
  const counted = new Set<string>();
  const occurrences: WarningOccurrence[] = [];
  const fixed = new Map<string, number>();
  // The model of the latest helper round, which a helper's fill picked into the source came from.
  let helperModel: string | undefined;
  const writer = (operationId: string | undefined, sha?: string, attempt?: number) => {
    const build = sha ? builds.get(`${operationId}|${sha}`) : undefined;
    if (build?.purpose === 'picks')
      return { purpose: 'helper-pick', ...(helperModel ? { model: helperModel } : {}) };
    const generation = generations.get(`${operationId}|${attempt ?? build?.attempt}`);
    return {
      purpose: generation?.purpose ?? build?.purpose ?? 'unknown',
      ...(generation?.model ? { model: generation.model } : {}),
      ...(generation?.reasoningEffort ? { reasoningEffort: generation.reasoningEffort } : {}),
      ...(generation
        ? { attempt: generation.attempt, generationRequestEventId: generation.eventId }
        : {})
    };
  };
  events.forEach((event, index) => {
    if (event.type === 'ai.generation-requested' && event.payload.purpose === 'helper')
      helperModel = text(event.payload.parameters.model) ?? helperModel;
    else if (event.type === 'ai.generation-requested' && !unversioned.has(event.payload.purpose))
      generations.set(`${event.operationId}|${event.payload.attempt}`, {
        purpose: event.payload.purpose,
        model: text(event.payload.parameters.model),
        reasoningEffort: text(event.payload.parameters.reasoningEffort),
        attempt: event.payload.attempt,
        eventId: event.id
      });
    else if (event.type === 'build.requested')
      builds.set(`${event.operationId}|${event.payload.source.sha256}`, {
        ...(event.payload.attempt ? { attempt: event.payload.attempt } : {}),
        purpose: event.payload.purpose
      });
    else if (event.type === 'visualization.presented') {
      const presentation = event.payload.presentation;
      if (presentation.format !== 'browser-bundle-v1') return;
      const sha = presentation.source.sha256;
      if (counted.has(sha)) return;
      counted.add(sha);
      const by = writer(event.operationId, sha);
      for (const code of new Set((presentation.warnings ?? []).map(codeOf)))
        occurrences.push({
          projectId,
          code,
          eventId: event.id,
          sourceSha256: sha,
          ...by,
          sentBack: false
        });
    } else if (event.type === 'revision.edits-rejected' && event.payload.rejected === 'warnings') {
      const codes = [
        ...new Set(event.payload.codes ?? event.payload.problems.map(() => 'uncoded'))
      ];
      const by = writer(event.operationId, undefined, event.payload.attempt);
      // The version the repair showed next in the turn, which fixed each code it lacks.
      const next = events
        .slice(index + 1)
        .find(
          (later) =>
            later.operationId === event.operationId && later.type === 'visualization.presented'
        );
      const shownCodes =
        next?.type === 'visualization.presented' &&
        next.payload.presentation.format === 'browser-bundle-v1'
          ? new Set((next.payload.presentation.warnings ?? []).map(codeOf))
          : undefined;
      for (const code of codes) {
        occurrences.push({ projectId, code, eventId: event.id, ...by, sentBack: true });
        if (shownCodes && !shownCodes.has(code)) fixed.set(code, (fixed.get(code) ?? 0) + 1);
      }
      counted.add(`rejected:${event.id}`);
    }
  });
  return { versions: counted.size, occurrences, fixed };
}

const codeOf = (warning: PresentationWarning) => presentationWarningCode(warning);

/** The summary over every project given. */
export function warningSummary(
  projects: readonly { id: string; events: readonly ProjectEvent[] }[]
): WarningSummary {
  const codes: Record<string, WarningCodeSummary & { projectIds: Set<string> }> = {};
  const occurrences: WarningOccurrence[] = [];
  let versions = 0;
  for (const project of projects) {
    const found = projectWarnings(project.id, project.events);
    versions += found.versions;
    occurrences.push(...found.occurrences);
    for (const occurrence of found.occurrences) {
      const entry = (codes[occurrence.code] ??= {
        occurrences: 0,
        projects: 0,
        byModel: {},
        byPurpose: {},
        sentBack: 0,
        fixedNext: 0,
        projectIds: new Set()
      });
      entry.occurrences++;
      entry.projectIds.add(project.id);
      const model = occurrence.model ?? 'none';
      entry.byModel[model] = (entry.byModel[model] ?? 0) + 1;
      entry.byPurpose[occurrence.purpose] = (entry.byPurpose[occurrence.purpose] ?? 0) + 1;
      if (occurrence.sentBack) entry.sentBack++;
    }
    for (const [code, count] of found.fixed) if (codes[code]) codes[code].fixedNext += count;
  }
  return {
    versions,
    codes: Object.fromEntries(
      Object.entries(codes)
        .sort(([, a], [, b]) => b.occurrences - a.occurrences)
        .map(([code, { projectIds, ...entry }]) => [code, { ...entry, projects: projectIds.size }])
    ),
    occurrences
  };
}
