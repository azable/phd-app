/**
 * Layouts that hold for a whole animation. Each step records what an arrangement contains, and the
 * arrangement is then solved once over the union of every step: every child that ever appears, at
 * its largest size, with every link. Each step places its children where that solution
 * put them and draws only the links it has, so nothing moves between steps but what changes, and a
 * node that appears later already has a place kept for it.
 */

import {
  arrange,
  keyedRandom,
  linkKey,
  linkSpecOf,
  type Anchor,
  type ArrangeBox,
  type ArrangeOptions,
  type ArrangeResult,
  type LinkSpec
} from './arrange';

/** A box inside a child, named by the child's key rather than its place at one step. */
export type KeyedAnchor = Omit<Anchor, 'box'> & { box: string };

/** What an arrangement contains at one step. */
export type SpanInput = {
  /** The seed the arrangement draws its choices from. */
  seed: number;
  boxes: ArrangeBox[];
  anchors: Record<string, KeyedAnchor>;
  parts: KeyedAnchor[];
  options: Pick<ArrangeOptions, 'links' | 'flow' | 'form' | 'curve' | 'gap' | 'aspect'>;
};

/** An arrangement solved over every step, with each child's place by key. */
export type SpanLayout = ArrangeResult & { positions: Record<string, { x: number; y: number }> };

/** Solve an arrangement once over the union of what it contains at every step. */
export function solveSpan(inputs: readonly SpanInput[]): SpanLayout {
  const boxes: ArrangeBox[] = [];
  const index = new Map<string, number>();
  for (const input of inputs)
    for (const box of input.boxes) {
      const at = index.get(box.key);
      if (at === undefined) {
        index.set(box.key, boxes.length);
        boxes.push({ ...box });
      } else {
        boxes[at].width = Math.max(boxes[at].width, box.width);
        boxes[at].height = Math.max(boxes[at].height, box.height);
      }
    }
  const located = (anchor: KeyedAnchor): Anchor | undefined => {
    const box = index.get(anchor.box);
    return box === undefined ? undefined : { ...anchor, box };
  };
  const anchors: Record<string, Anchor> = {};
  for (const input of inputs)
    for (const [key, anchor] of Object.entries(input.anchors))
      if (!anchors[key]) {
        const found = located(anchor);
        if (found) anchors[key] = found;
      }
  const parts = inputs.flatMap((input) => input.parts.flatMap((part) => located(part) ?? []));
  const [first] = inputs;
  // Links at every step where both their ends are decide the structure, so a tree that grows keeps
  // each link from when its child joins; ones that come and go are drawn on top of it.
  const idsAt = inputs.map(
    ({ options }) => new Set((options.links ?? []).flatMap((link) => linkKey(link) ?? []))
  );
  const boxesAt = inputs.map(({ boxes: at }) => new Set(at.map(({ key }) => key)));
  // The children a link joins, by key, from a step that has it.
  const ends = new Map<string, [string, string]>();
  inputs.forEach((input, step) => {
    const boxOf = (key: string) =>
      input.anchors[key]?.box ?? (boxesAt[step].has(key) ? key : undefined);
    for (const link of input.options.links ?? []) {
      const id = linkKey(link);
      const spec = linkSpecOf(link);
      if (!id || !spec || ends.has(id)) continue;
      const [from, to] = [boxOf(spec.from), boxOf(spec.to)];
      if (from !== undefined && to !== undefined) ends.set(id, [from, to]);
    }
  });
  const permanent = new Set(
    [...ends].flatMap(([id, [from, to]]) =>
      idsAt.every((ids, step) => ids.has(id) || !boxesAt[step].has(from) || !boxesAt[step].has(to))
        ? [id]
        : []
    )
  );
  const solved = arrange(boxes, {
    ...first.options,
    links: unionLinks(inputs.map(({ options }) => options.links)),
    // The tightest space any step leaves, so the layout fits at every step.
    aspect: Math.min(...inputs.map(({ options }) => options.aspect ?? 16 / 9)),
    anchors,
    parts,
    permanent,
    random: keyedRandom(first.seed, 'layout')
  });
  return {
    ...solved,
    positions: Object.fromEntries(solved.placements.map(({ key, x, y }) => [key, { x, y }]))
  };
}

/** Every link any step has, once each: a link component by its id, a written link by its text. */
function unionLinks(lists: readonly (readonly (string | LinkSpec)[] | undefined)[]) {
  const seen = new Map<string, string | LinkSpec>();
  for (const link of lists.flatMap((list) => list ?? [])) {
    const key =
      typeof link === 'string' ? `text:${link.trim()}` : `id:${link.id ?? JSON.stringify(link)}`;
    if (!seen.has(key)) seen.set(key, typeof link === 'string' ? link.trim() : link);
  }
  return [...seen.values()];
}

/**
 * Solve every arrangement from what the steps recorded, returning whether any solution changed: a
 * nested arrangement's new size changes what its parent contains, so recording repeats until
 * nothing does.
 */
export function settleSpans(
  scopes: Map<string, { inputs: Map<number, SpanInput>; span?: SpanLayout }>
): boolean {
  let changed = false;
  for (const entry of scopes.values()) {
    if (!entry.inputs.size) continue;
    const steps = [...entry.inputs.keys()].sort((a, b) => a - b);
    const span = solveSpan(steps.map((step) => entry.inputs.get(step) as SpanInput));
    const shape = (layout?: SpanLayout) =>
      layout && JSON.stringify([layout.positions, layout.width, layout.height]);
    if (shape(span) !== shape(entry.span)) changed = true;
    entry.span = span;
  }
  return changed;
}
