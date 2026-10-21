/** The prop types of a Node's markup and of the page frame; looks are the design's (see design.ts). */

/** A single value a node can display. */
export type Primitive = string | number | boolean | null;

/** How a node arranges its items or children. */
export type Layout = 'row' | 'column' | 'free';

/** How arranged items line up across the layout direction. */
export type Align = 'start' | 'center' | 'end';

/** How arranged items spread along the layout direction. */
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

/** The page frame's aspect ratio; it lays out at a fixed logical size and scales to fit the page. */
export type FrameRatio = '16:9' | '4:3' | '3:2' | '1:1' | '3:4' | '9:16';

/** How the page frame is shaped and arranges the view's top-level nodes (the variant's frame.* values). */
export type FrameSettings = {
  ratio: FrameRatio;
  justify: Justify;
  align: Align;
  /** Space inside the frame, and between its top-level nodes, in em. */
  padding: number;
  gap: number;
  /** How the view's top-level nodes are arranged. */
  layout: FrameLayout;
};

/** The arrangements the page frame offers its top-level nodes. */
export type FrameLayout = 'column' | 'row';

/** Spacing in em, as an arrangement takes its gap. */
export type Spacing = number;
