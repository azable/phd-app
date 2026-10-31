/**
 * The page's own style sheet, which every step is drawn on and laid out by, in the page and on the
 * server alike: the theme, the fonts, the layers steps are drawn in, and how values move between
 * them.
 */

import { fontCss } from './fonts';
import { motionCss } from './motion';
import type { ModelElement } from './model/tree';
import { themeCss } from './theme';

export const pageCss = `${themeCss}
${fontCss}
.sv-layer { position: fixed; inset: 0; }
.sv-layer.pending { visibility: hidden; }
.sv-layer:not(.pending) [data-sv-hidden='true'] { visibility: hidden; }
.sv-layer:not(.pending):not(.sv-leaving) [data-sv-hidden='false'] { visibility: visible; }
${motionCss}`;

/** The page's elements around the layer each step is drawn in, outermost first (see sandbox.ts). */
export const pageAncestors: readonly ModelElement[] = [
  { tag: 'html', attributes: {}, style: {}, children: [] },
  { tag: 'body', attributes: {}, style: {}, children: [] },
  { tag: 'div', attributes: { id: 'app' }, style: {}, children: [] }
];
