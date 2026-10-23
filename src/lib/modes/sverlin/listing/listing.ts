/** A listing as the page lights it: its text, and which parts of it each node of the source is. */

/** A part of a listing's text, as the node with the key (see spanKey) shows it there. */
export type Mark = { key: string; start: number; end: number };

/**
 * A listing's text and its marks, and its regions, so a lit region can leave out the regions inside
 * it that did not run (see light.server.ts).
 */
export type Listing = {
  text: string;
  marks: readonly Mark[];
  regions?: readonly { start: number; end: number }[];
};
