/**
 * Parts of a presentation's scenes drawn by themselves, for pictures that judge one part: a view
 * of a type drawn alone, a few of its values side by side, as the helpers' scoring stage shows it
 * (server/ai/choosing), and the steps worth a look of a whole presentation.
 */

import type { SceneBox, SceneFrame, SceneNode, SceneStep } from '../library';

const moved = (box: SceneBox, dx: number, dy: number): SceneBox => ({
  ...box,
  x: box.x + dx,
  y: box.y + dy
});

/** A node with everything it draws moved by dx, dy. */
function movedNode(node: SceneNode, dx: number, dy: number): SceneNode {
  return {
    ...node,
    box: moved(node.box, dx, dy),
    ...(node.runs
      ? { runs: node.runs.map((run) => ({ ...run, box: moved(run.box, dx, dy) })) }
      : {}),
    ...(node.marks
      ? { marks: node.marks.map((mark) => ({ ...mark, box: moved(mark.box, dx, dy) })) }
      : {}),
    ...(node.shapes
      ? {
          shapes: node.shapes.map((shape) => ({
            ...shape,
            parts: shape.parts.map((part) => part.map(({ x, y }) => ({ x: x + dx, y: y + dy })))
          }))
        }
      : {})
  };
}

/** A node and every node inside it, in drawing order. */
function subtree(step: SceneStep, root: SceneNode): SceneNode[] {
  const inside = new Set([root.id]);
  return step.nodes.filter((node) => {
    if (node === root) return true;
    if (node.parent && inside.has(node.parent)) {
      inside.add(node.id);
      return true;
    }
    return false;
  });
}

/** What a drawn value shows, to tell values drawn alike apart. */
const shown = (nodes: readonly SceneNode[]) =>
  nodes.map((node) => [node.kind, node.value, node.text, node.colours?.fill].join('|')).join(';');

/**
 * A view of `type` drawn alone: up to `most` of the values it draws over all steps, those drawn
 * differently first found, side by side with `gap` between them, on the frame's background. None
 * where no step draws a value of the type.
 */
export function viewAlone(
  scenes: { frame: SceneFrame; steps: readonly SceneStep[] },
  type: string,
  most = 4,
  gap = 16
): { frame: SceneFrame; steps: SceneStep[] } | undefined {
  const picked: SceneNode[][] = [];
  const seen = new Set<string>();
  for (const step of scenes.steps) {
    const byId = new Map(step.nodes.map((node) => [node.id, node]));
    const typedAbove = (node: SceneNode) => {
      for (let up = node.parent; up; up = byId.get(up)?.parent)
        if (byId.get(up)?.type === type) return true;
      return false;
    };
    for (const node of step.nodes) {
      if (picked.length >= most) break;
      if (node.type !== type || typedAbove(node)) continue;
      const drawn = subtree(step, node);
      const key = shown(drawn);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(drawn);
    }
  }
  if (!picked.length) return undefined;
  let x = gap;
  const nodes: SceneNode[] = [];
  for (const drawn of picked) {
    const root = drawn[0];
    nodes.push(
      ...drawn.map((node, index) => {
        const placed = movedNode(node, x - root.box.x, gap - root.box.y);
        return index === 0 ? { ...placed, parent: undefined } : placed;
      })
    );
    x += root.box.width + gap;
  }
  const height = Math.max(...picked.map((drawn) => drawn[0].box.height)) + 2 * gap;
  return {
    frame: { width: x, height, background: scenes.frame.background },
    steps: [{ nodes, links: [] }]
  };
}

/**
 * The steps worth a look of a whole presentation: the first, the one drawing the most nodes, and
 * the last, each once, in order.
 */
export function telltaleSteps(steps: readonly SceneStep[]): number[] {
  if (!steps.length) return [];
  const most = steps.reduce(
    (best, step, index) => (step.nodes.length > steps[best].nodes.length ? index : best),
    0
  );
  return [...new Set([0, most, steps.length - 1])].sort((a, b) => a - b);
}
