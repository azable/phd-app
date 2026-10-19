/** Every prop type of a Node, the props a type renderer receives, and the shape of drawn defaults. */

/** A single value a node can display. */
export type Primitive = string | number | boolean | null;

/** How a node arranges its items or children. */
export type Layout = 'row' | 'column' | 'grid' | 'free';

/** How arranged items line up across the layout direction. */
export type Align = 'start' | 'center' | 'end';

/** How arranged items spread along the layout direction. */
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

/** The page frame's aspect ratio; it lays out at a fixed logical size and scales to fit the page. */
export type FrameRatio = '16:9' | '4:3' | '3:2' | '1:1' | '3:4' | '9:16';

/** How the page frame is shaped and arranges the view's top-level nodes (resolved from the design value `frame`). */
export type FrameSettings = {
  ratio: FrameRatio;
  /** Unset, it comes from the drawn defaults. */
  justify?: Justify;
  /** Unset, it comes from the drawn defaults. */
  align?: Align;
  padding: Spacing;
  /** How the view's top-level nodes are arranged; unset, it comes from the drawn defaults. */
  layout?: FrameLayout;
  /** Relations between top-level nodes by key, as for a node's constraints. */
  constraints?: string[];
  /** A seed for the top-level arrangement alone, to keep a free layout the participant liked. */
  layoutSeed?: number;
  /** Set when <Link> components join top-level nodes, so the root lays out with them. */
  linked?: boolean;
};

/** The arrangements the page frame offers its top-level nodes. */
export type FrameLayout = 'column' | 'row' | 'free';

/** Which of the presentation's drawn looks a node takes: a cell, a card, or none. */
export type NodeShape = 'box' | 'card' | 'plain';

/** A theme palette colour, giving a light shade as a fill and a strong shade as a stroke or text. */
export type PaletteColor = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

/** A palette colour name, or any other CSS colour. */
export type NodeColor = PaletteColor | (string & {});

/** Font family of a node, from the system fonts the sandbox can use. */
export type NodeFont = 'sans' | 'serif' | 'mono';

/** Named node text size; a number is a size in rem instead. */
export type NodeSize = 'small' | 'medium' | 'large' | 'xlarge';

/** Named spacing for padding and gaps; a number is a size in em instead. */
export type Spacing = 'none' | 'small' | 'medium' | 'large' | number;

/** Corner rounding; 'full' gives a circle or pill. */
export type Radius = 'none' | 'small' | 'medium' | 'full';

/** A stroke width; a number is a width in pixels. */
export type StrokeWidth = 'none' | 'thin' | 'thick' | number;

/** A stroke colour, or 'none' or false for no stroke. */
export type NodeStroke = NodeColor | 'none' | false;

/** The smallest a node may be; a number is a size in em instead. */
export type MinSize = 'none' | 'small' | 'medium' | 'large' | number;

export type Weight = 'normal' | 'bold';

/** The props a node was given, passed to its type's renderer so the caller's settings win. */
export type NodeProps = {
  shape?: NodeShape;
  fill?: NodeColor;
  stroke?: NodeStroke;
  opacity?: number;
  color?: NodeColor;
  font?: NodeFont;
  size?: NodeSize | number;
  weight?: Weight;
  padding?: Spacing;
  radius?: Radius;
  strokeWidth?: StrokeWidth;
  minSize?: MinSize;
  /** Internal: the caller's selection id, so the renderer's node stands for it. */
  __id?: string;
  /** Internal: the caller's atomic type. */
  __type?: string;
};

/** Defaults one presentation drew for a framed shape (see defaults.ts). */
export type ShapeDefaults = {
  radius: Radius;
  strokeWidth: StrokeWidth;
  padding: Spacing;
  fill: string;
  stroke: string;
  /** A cell's text weight, and text size relative to its surroundings, in em. */
  weight?: Weight;
  scale?: number;
};

/**
 * Defaults one presentation drew: per framed shape, how a frame spreads and aligns its children,
 * a collection's shape, how rows and columns align their items, the gap between items, the page
 * font, and the width of links in pixels.
 */
export type NodeDefaults = {
  box: ShapeDefaults;
  card: ShapeDefaults;
  frame: { justify: Justify; align: Align; layout: FrameLayout };
  collection: { shape: NodeShape };
  align: { row: Align; column: Align };
  gap: Spacing;
  font: NodeFont;
  link: { strokeWidth: number };
};
