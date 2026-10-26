/** A listing as the page lights it: its text, and which parts of it each node of the source is. */

/**
 * A part of a listing's text, as the node with the key (see spanKey) shows it in the region of the
 * label, by its full name; with the code it stands for (scope), which has run once the code being
 * run is outside it, unless it holds other statements (compound), which has run once its own code
 * has: its test, where it has one, once the code being run has left it.
 */
export type Mark = {
  key: string;
  label: string;
  start: number;
  end: number;
  scope?: { start: number; end: number };
  compound?: boolean;
  test?: { start: number; end: number };
};

/**
 * A listing's text and its marks, and its regions, by their labels' full names, so a lit region can
 * leave out the regions inside it that did not run (see light.server.ts) and the page can paint each
 * region as its place says.
 */
export type Listing = {
  text: string;
  marks: readonly Mark[];
  regions?: readonly { label: string; start: number; end: number }[];
};
