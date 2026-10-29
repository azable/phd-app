/**
 * Arrowheads: the marks a link draws at the ends its data points to, each a shape of its kind's
 * `head` at its `headSize`. A shape lies along the line from its back to its tip, as wide as it is
 * long, its tip on the end box's edge; a shape the line would show through, as an open triangle,
 * has the line stop at its back, and one drawn over the line, as a vee, lets it run to the tip.
 */

export const headShapes = ['none', 'arrow', 'open', 'vee', 'dot', 'diamond', 'bar'] as const;
export type HeadShape = (typeof headShapes)[number];

export const headSizes = [6, 9, 12, 16] as const;

type Drawing = {
  /** Its outline in a 10 by 10 box, the back at x 0 and the tip at x 10, centred on y 5. */
  path: string;
  /** Whether it is filled, or drawn as a line of the link's width. */
  filled: boolean;
  /** Whether the line stops at its back rather than running on to its tip. */
  stops: boolean;
};

const drawings: Record<Exclude<HeadShape, 'none'>, Drawing> = {
  arrow: { path: 'M0,0 L10,5 L0,10 z', filled: true, stops: true },
  open: { path: 'M1,1 L9,5 L1,9 z', filled: false, stops: true },
  vee: { path: 'M2,0.5 L10,5 L2,9.5', filled: false, stops: false },
  dot: { path: 'M0,5 A5,5 0 1 0 10,5 A5,5 0 1 0 0,5 z', filled: true, stops: true },
  diamond: { path: 'M0,5 L5,1.5 L10,5 L5,8.5 z', filled: true, stops: true },
  bar: { path: 'M10,0 L10,10', filled: false, stops: false }
};

/** How a head is drawn, or none for no head. */
export const headDrawing = (shape: string | undefined): Drawing | undefined =>
  shape && shape !== 'none' ? drawings[shape as Exclude<HeadShape, 'none'>] : undefined;

/** How far a line stops short of its end for a head there: the head's length, where it stops. */
export const headTrim = (shape: string | undefined, size: number): number =>
  headDrawing(shape)?.stops ? size : 0;

/** Which ends of a link carry its head: the end it points to, and its start too for a two-way line. */
export type HeadEnds = { start: boolean; end: boolean };

/** A head's look, which names the SVG marker drawing it: one per shape, size, colour and width. */
export type HeadLook = { shape: string; size: number; colour: string; width: number };

export const headKey = ({ shape, size, colour, width }: HeadLook): string =>
  `${shape}|${size}|${colour}|${width}`;
