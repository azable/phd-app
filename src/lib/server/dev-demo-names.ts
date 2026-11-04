import { namedPresentations } from '$lib/shared/presentation-names';
import type { ProjectEvent } from '$lib/shared/projects/events';

/**
 * The demo's names with those of the presentations an operation showed added, each naming the
 * example it was built from, as `{"3fa2c1/Misty-Falcon-09": "19-expand-packed"}`.
 */
export function withExampleNames(
  names: Readonly<Record<string, string>>,
  events: readonly ProjectEvent[],
  operationId: string,
  example: string
): Record<string, string> {
  const shown = namedPresentations(events.filter((event) => event.operationId === operationId));
  return { ...names, ...Object.fromEntries(shown.map(({ name }) => [name, example])) };
}
