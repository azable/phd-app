/**
 * The page's own style sheet, which every step is laid out by on the server and drawn on in the
 * page: the theme and the fonts.
 */

import { fontCss } from './fonts';
import type { ModelElement } from './model/tree';
import { themeCss } from './theme';

export const pageCss = `${themeCss}
${fontCss}`;

/** The page's elements around each step's markup, outermost first (see sandbox.ts). */
export const pageAncestors: readonly ModelElement[] = [
  { tag: 'html', attributes: {}, style: {}, children: [] },
  { tag: 'body', attributes: {}, style: {}, children: [] },
  { tag: 'div', attributes: { id: 'app' }, style: {}, children: [] }
];
