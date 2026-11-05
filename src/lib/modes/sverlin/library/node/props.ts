/** The prop types of a Node's markup and of the page frame; looks are the design's (see design.ts). */

/** A single value a node can display. */
export type Primitive = string | number | boolean | null;

/** How a node arranges its items or children. */
export type Layout = 'row' | 'column' | 'grid' | 'free' | 'stack';

/** How arranged items line up across the layout direction. */
export type Align = 'start' | 'center' | 'end';

/** How arranged items spread along the layout direction. */
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

/**
 * The page frame's aspect ratio; it lays out at a fixed logical width and scales to fit the page.
 * fit takes the shape of what the frame holds, between the widest and tallest of the others.
 */
export type FrameRatio = 'fit' | '16:9' | '4:3' | '3:2' | '1:1' | '3:4' | '9:16';

/**
 * How the page frame is shaped and arranges what the layout shown holds: the layout's kind's values,
 * as Stacked.ratio, its root's row or column, and its root's tag, which selecting the page selects.
 */
export type FrameSettings = {
  ratio: FrameRatio;
  justify: Justify;
  align: Align;
  /** Space inside the frame, and between what it holds, in em. */
  padding: number;
  gap: number;
  /** How what the layout holds is arranged. */
  layout: FrameLayout;
  /** The layout shown, and its root <Node>'s line:column. */
  name: string;
  ref: string;
};

/** The arrangements the page frame offers its top-level nodes. */
export type FrameLayout = 'column' | 'row';

/** Spacing in em, as an arrangement takes its gap. */
export type Spacing = number;
