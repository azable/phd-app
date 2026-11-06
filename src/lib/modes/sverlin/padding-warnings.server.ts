/**
 * Padding nobody sees, told to the assistant: padding is space inside a box, so on a node that
 * arranges others without a box of its own it adds up as they nest, and on a node that never shows
 * a box it only pushes its neighbours away. Both are looks only, so neither sends a version back
 * (see designOnlyWarning). The template principle "Padding inside a box, gaps between items" in
 * the project's design notes says why.
 */

import type { DesignValue } from './design.server';
import type { KindRole } from './library/node/design';
import type { SceneNode, SceneStep } from './library';

/**
 * What every padding warning ends with, which keeps it from sending a version back for repair
 * (see returnedWarnings in server/projects/commands.ts): the picture is right, only roomier.
 */
export const designOnlyWarning = 'The picture is drawn as it is.';

/** How many kinds each warning names before it counts the rest, as the repeat warning does. */
const kindsTold = 5;

/**
 * The least size a node a reader clicks keeps, padding included, so a small one may keep its
 * padding: 24 × 24 CSS pixels (WCAG 2.2 SC 2.5.8 Target Size (Minimum),
 * https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
 */
const leastTarget = 24;

const boxed = ({ look }: SceneNode) =>
  Boolean(look.fill) || (Boolean(look.stroke) && (look.strokeWidth ?? 0) > 0);

/** Whether a node's box without its padding is under the least target either way. */
function small({ box, look }: SceneNode): boolean {
  const [top, right, bottom, left] = look.padding ?? [0, 0, 0, 0];
  return box.width - left - right < leastTarget || box.height - top - bottom < leastTarget;
}

function named(kinds: readonly string[]): string {
  const told = kinds.slice(0, kindsTold).join(', ');
  const rest = kinds.length - kindsTold;
  return rest > 0 ? `${told} and ${rest} more` : told;
}

/**
 * The padding warnings of a build's drawn steps, for kinds whose padding the design sets above 0
 * and which show no box at any step: one for those whose nodes arrange others (a layout), one for
 * the rest, where no pointer paints them, no links end at them (a vertex) and they are not small.
 * A page's layout (`pages`) sets the page's margin with its padding, which its nodes written
 * without a kind take too, so its warning says to give them a kind.
 */
export function paddingWarnings(
  steps: readonly SceneStep[],
  roles: Readonly<Record<string, KindRole>>,
  values: Readonly<Record<string, DesignValue>>,
  pages: ReadonlySet<string>
): string[] {
  const nodes = steps.flatMap((step) => step.nodes);
  // The ids a pointer's paint is drawn at: the element there has the pointer's kind at that step
  // and its own at the others, so its own kind shows a box where the pointer is.
  const painted = new Set(
    nodes.filter(({ kind }) => kind?.endsWith('.Pointed')).map(({ id }) => id)
  );
  const byKind = new Map<string, SceneNode[]>();
  for (const node of nodes)
    if (node.kind && !node.kind.startsWith('listing'))
      byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);

  const pageKinds: string[] = [];
  const arranging: string[] = [];
  const unseen: string[] = [];
  for (const [kind, drawn] of byKind) {
    const padding = values[`${kind}.padding`];
    if (typeof padding !== 'number' || padding <= 0) continue;
    const role = roles[kind];
    if (role === 'pointed' || role === 'vertex' || role === 'bar') continue;
    if (drawn.some((node) => boxed(node) || painted.has(node.id))) continue;
    const written = `${kind} (padding ${padding})`;
    if (pages.has(kind)) pageKinds.push(written);
    else if (drawn.some(({ layout }) => layout)) arranging.push(written);
    else if (!drawn.some(small)) unseen.push(written);
  }

  const has = (kinds: readonly string[]) => (kinds.length === 1 ? 'has' : 'have');
  const warnings: string[] = [];
  if (pageKinds.length)
    warnings.push(
      `${named(pageKinds)}: a page's padding is its margin, and each node in that layout written without a kind takes it too, so every row, column, stack and line in it is padded again, adding up as they nest. Give those nodes a kind of their own, as <Node kind="Panel" layout="column">, so they keep to their gap. ${designOnlyWarning}`
    );
  if (arranging.length)
    warnings.push(
      `${named(arranging)} arrange${arranging.length === 1 ? 's' : ''} other nodes with no box of ${arranging.length === 1 ? 'its' : 'their'} own and ${has(arranging)} padding, which adds up as such nodes nest. Give space between items with the node's gap, or give it a box. ${designOnlyWarning}`
    );
  if (unseen.length)
    warnings.push(
      `${named(unseen)} ${has(unseen)} padding but never ${unseen.length === 1 ? 'shows' : 'show'} a fill or a stroke, so the padding is space nobody sees. Use the parent's gap for space between items, or give the kind a box. ${designOnlyWarning}`
    );
  return warnings;
}
