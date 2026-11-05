import type { ProjectEvent } from './events';

/** The latest dev-mode switch of the view helpers on a project, where an administrator set one. */
export function viewHelpersSwitch(events: readonly ProjectEvent[]): boolean | undefined {
  const set = events.findLast((event) => event.type === 'project.view-helpers-set');
  return set?.type === 'project.view-helpers-set' ? set.payload.enabled : undefined;
}
