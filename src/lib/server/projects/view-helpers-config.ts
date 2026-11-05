/**
 * Whether a project's turns run the view helpers: an administrator's dev-mode switch on the
 * project, else its study condition's `viewHelpers`, else off. Each turn records the answer on its
 * assistant.turn-started event, which the turn then follows.
 */

import type { ProjectDocument } from '$lib/shared/projects/model';
import { defaultHelperCounts, type HelperCounts } from '$lib/shared/study/definition';
import { viewHelpersSwitch } from '$lib/shared/projects/view-helpers';
import { projectTrialCondition, studyProjectContext } from '$lib/server/study';

/** The study condition's setting for a project, or its trial condition's outside a study. */
export async function conditionViewHelpers(projectId: string): Promise<boolean> {
  const study = await studyProjectContext(projectId);
  if (study) return study.viewHelpers ?? false;
  return (await projectTrialCondition(projectId, study))?.viewHelpers ?? false;
}

/** Whether the next turn of this project runs the view helpers. */
export async function projectViewHelpers(document: ProjectDocument): Promise<boolean> {
  return viewHelpersSwitch(document.events) ?? (await conditionViewHelpers(document.projectId));
}

/** How many helpers a round runs for a project: its study or trial condition's, else the defaults. */
export async function conditionHelperCounts(projectId: string): Promise<HelperCounts> {
  const study = await studyProjectContext(projectId);
  const counts = study
    ? study.helperCounts
    : (await projectTrialCondition(projectId, study))?.helperCounts;
  return { ...defaultHelperCounts, ...counts };
}

/** How many helpers the turn now running runs, as its start recorded. */
export function turnHelperCounts(document: ProjectDocument): HelperCounts {
  const started = document.events.findLast((event) => event.type === 'assistant.turn-started');
  return (
    (started?.type === 'assistant.turn-started' && started.payload.helperCounts) ||
    defaultHelperCounts
  );
}

/** Whether the turn now running runs the view helpers, as its start recorded. */
export function turnViewHelpers(document: ProjectDocument): boolean {
  const started = document.events.findLast((event) => event.type === 'assistant.turn-started');
  return started?.type === 'assistant.turn-started' && started.payload.viewHelpers === true;
}
