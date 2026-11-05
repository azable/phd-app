/**
 * The files a Sverlin presentation can be exported as, each made on the server from its scene data
 * (see export.server.ts).
 */

import type { RenderTarget } from '../../render-targets';

export const sverlinTargets: RenderTarget[] = [
  { id: 'pdf', title: 'PDF, a page per step', animated: false },
  { id: 'scene', title: 'Scene data (JSON)', animated: false }
];

/** The name an export of a version is saved as. */
export const exportName = (presentationId: string, seed: number, extension: string): string =>
  `presentation-${presentationId.slice(0, 8)}-seed-${seed}.${extension}`;
