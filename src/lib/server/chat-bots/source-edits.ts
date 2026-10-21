/**
 * Edits an assistant makes to a source instead of rewriting it: each replaces text that occurs
 * exactly once in the source as the edits before it left it, so an edit cannot land in the wrong
 * place, and an edit that cannot be placed is reported back for the assistant to correct.
 */

/** One edit: `find` occurs exactly once, and becomes `replace`. */
export type SourceEdit = { find: string; replace: string };

/** The edited source, or what kept each edit that could not be placed from applying. */
export function applySourceEdits(
  source: string,
  edits: readonly SourceEdit[]
): { source: string } | { problems: string[] } {
  const problems: string[] = [];
  let edited = source;
  edits.forEach(({ find, replace }, index) => {
    const name = `Edit ${index + 1}`;
    if (!find) {
      problems.push(`${name} has no text to find.`);
      return;
    }
    const at = edited.indexOf(find);
    if (at === -1) {
      problems.push(
        `${name}'s find text does not occur in the source${index ? ' after the edits before it' : ''}: copy it exactly from the source, whitespace included.`
      );
      return;
    }
    const again = edited.indexOf(find, at + 1);
    if (again !== -1) {
      problems.push(
        `${name}'s find text occurs more than once: include enough of the lines around it that it occurs once.`
      );
      return;
    }
    edited = edited.slice(0, at) + replace + edited.slice(at + find.length);
  });
  if (!edits.length) problems.push('No edits were given.');
  return problems.length ? { problems } : { source: edited };
}
