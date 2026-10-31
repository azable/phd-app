/**
 * How far the frame scales its root (see Frame.svelte): down when its content is too big for the
 * frame's inside, and up, to a limit, when it would leave the frame mostly empty, so every design
 * uses the space it has. A step laid out on the layout model is fitted the same way (model/drawn.ts).
 */

type Size = { width: number; height: number };

const largestFit = 1.6;

/** The fit content of a size needs in the frame's inside. */
export function neededFit(inside: Size, content: Size): number {
  return Math.min(
    largestFit,
    inside.width / Math.max(1, content.width),
    inside.height / Math.max(1, content.height)
  );
}

/**
 * The extent of a CSS root's children, by their sizes, laid out in its direction with a gap between
 * each: the root is stretched to the frame, so its content's own extent is measured instead.
 */
export function flowExtent(children: readonly Size[], gap: number, row: boolean): Size {
  const gaps = gap * Math.max(0, children.length - 1);
  const total = (sizes: number[]) => sizes.reduce((sum, size) => sum + size, 0) + gaps;
  const widths = children.map(({ width }) => width);
  const heights = children.map(({ height }) => height);
  return row
    ? { width: total(widths), height: Math.max(0, ...heights) }
    : { width: Math.max(0, ...widths), height: total(heights) };
}
