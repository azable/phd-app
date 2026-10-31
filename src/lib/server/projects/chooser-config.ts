/**
 * Which chooser a project's variants come from: its study condition's, else SVERLIN_CHOOSER, else
 * the model.
 */

import { studyProjectContext } from '$lib/server/study';
import { chooserIds, type ChooserId } from '$lib/shared/choosers';

const isChooserId = (value: unknown): value is ChooserId => chooserIds.includes(value as ChooserId);

/** The chooser configured where no study condition names one. */
export function defaultChooserId(): ChooserId {
  const configured = process.env.SVERLIN_CHOOSER?.trim();
  return isChooserId(configured) ? configured : 'model';
}

export async function projectChooserId(projectId: string): Promise<ChooserId> {
  return (await studyProjectContext(projectId))?.chooser ?? defaultChooserId();
}
