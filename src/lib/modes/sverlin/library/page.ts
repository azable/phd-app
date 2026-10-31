/**
 * The page's own style sheet, which every step is drawn on and laid out by: the theme, the layers
 * steps are drawn in, and how values move between them.
 */

import { motionCss } from './motion';
import { themeCss } from './theme';

export const pageCss = `${themeCss}
.sv-layer { position: fixed; inset: 0; }
.sv-layer.pending { visibility: hidden; }
.sv-layer:not(.pending) [data-sv-hidden='true'] { visibility: hidden; }
.sv-layer:not(.pending):not(.sv-leaving) [data-sv-hidden='false'] { visibility: visible; }
${motionCss}`;
