/** What the project's running operations are doing, as the visualization stage shows it. */

import type { ProjectEvent, ProjectOperationKind } from '$lib/shared/projects/events';
import { pendingAssistantTurnRequests, projectOperations } from '$lib/shared/projects/operations';
import type { RenderablePresentation } from '$lib/shared/presentations';

export type StageActivity = {
  label: string;
  /** Whether the operation will replace the shown version, which then reads as the old one. */
  replacing: boolean;
};

const thinking: StageActivity = { label: 'Thinking…', replacing: false };
const applying: StageActivity = { label: 'Applying your change…', replacing: true };

/**
 * The activity to show over the stage, from every running operation: the first that says what it
 * is doing, replacing the shown version if any will.
 *
 * @param shownSource The hash of the source the shown version was built from.
 * @param submitting A command sent but not yet accepted into the Timeline.
 */
export function stageActivity(
  events: readonly ProjectEvent[],
  shownSource: string | undefined,
  submitting?: { type: ProjectOperationKind; operationId: string }
): StageActivity | undefined {
  const running = projectOperations(events).filter(
    ({ status }) => status === 'accepted' || status === 'running'
  );
  const activities = running.map(({ kind, operationId }) =>
    operationActivity(
      kind,
      events.filter((event) => event.operationId === operationId),
      shownSource
    )
  );
  if (submitting && !running.some(({ operationId }) => operationId === submitting.operationId))
    activities.push(operationActivity(submitting.type, [], shownSource));
  // A message waits for an assistant turn to take it up.
  if (
    pendingAssistantTurnRequests(events).length &&
    !running.some(({ kind }) => kind === 'assistant-turn')
  )
    activities.push(thinking);
  const shown = activities.filter((activity) => activity !== undefined);
  const [first] = shown;
  return first && { label: first.label, replacing: shown.some(({ replacing }) => replacing) };
}

function operationActivity(
  kind: ProjectOperationKind,
  events: readonly ProjectEvent[],
  shownSource: string | undefined
): StageActivity | undefined {
  // Once it shows something, the rest it builds waits in the background.
  if (events.some(({ type }) => type === 'visualization.presented')) return undefined;
  const build = events.findLast((event) => event.type === 'build.requested');
  switch (kind) {
    case 'feedback':
    case 'assistant-turn':
      if (build?.type !== 'build.requested') return thinking;
      return build.payload.source.sha256 === shownSource ? building(build) : applying;
    case 'initial-build':
    case 'rebuild':
    case 'resample':
      return building(build);
    case 'save':
    case 'restore':
      return applying;
    default:
      return undefined;
  }
}

/**
 * Whether an assistant turn other than the one that showed the stage's version is waiting or
 * running: what it replies will change the stage, so an answer given meanwhile would be moot.
 */
export function assistantTurnAfter(
  events: readonly ProjectEvent[],
  shownOperationId: string | undefined
): boolean {
  return (
    pendingAssistantTurnRequests(events).length > 0 ||
    projectOperations(events).some(
      ({ kind, status, operationId }) =>
        kind === 'assistant-turn' &&
        (status === 'accepted' || status === 'running') &&
        operationId !== shownOperationId
    )
  );
}

/**
 * Whether a presentation shows a blank project's starter (“Start your visualization”), built from
 * the source the project was created with: a stand-in until its first version, not a version.
 */
export function blankStarter(
  events: readonly ProjectEvent[],
  presentation: RenderablePresentation
): boolean {
  const created = events.find((event) => event.type === 'project.created');
  if (created?.type !== 'project.created' || created.payload.creation.templateId !== 'blank')
    return false;
  const initial = events.find(
    (event) => event.type === 'artifact.version-created' && event.payload.origin.kind === 'initial'
  );
  if (initial?.type !== 'artifact.version-created') return false;
  const shown =
    presentation.format === 'browser-bundle-v1' ? presentation.source : presentation.authored;
  return initial.payload.changes.some(
    (change) => change.operation === 'upsert' && change.artifact.content.sha256 === shown.sha256
  );
}

function building(build: ProjectEvent | undefined): StageActivity {
  const count = build?.type === 'build.requested' ? (build.payload.batchSize ?? 1) : 1;
  return { label: count > 1 ? `Building ${count} versions…` : 'Building…', replacing: false };
}
