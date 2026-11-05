/**
 * Whether a project's turns run the view helpers: an administrator's dev-mode switch on the
 * project, else its study condition's `viewHelpers`, else off. Each turn records the answer on its
 * assistant.turn-started event, which the turn then follows.
 */

import type { ProjectDocument } from '$lib/shared/projects/model';
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

/** Whether the turn now running runs the view helpers, as its start recorded. */
export function turnViewHelpers(document: ProjectDocument): boolean {
  const started = document.events.findLast((event) => event.type === 'assistant.turn-started');
  return started?.type === 'assistant.turn-started' && started.payload.viewHelpers === true;
}
