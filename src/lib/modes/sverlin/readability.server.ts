/**
 * How large a presentation draws on a typical stage, from its layout on the server (see
 * layout.server.ts): the frame and the fit it shows its content at, as the page draws them (see
 * library/fit.ts shownFrame), and the stage scaling the frame to fit the pane it shows in (see
 * library/Frame.svelte).
 */

import type { Readability } from '$lib/shared/readability';

import type { DrawnSize } from './layout.server';
import type { FrameRatio } from './library/node/props';

/**
 * The stage one version shows on, in CSS pixels: the presentation pane at its default 68% of a
 * 1440×900 laptop screen (ProjectWorkspace.svelte), less the browser's and the app's bars. A
 * comparison stacks its two sides, each half as tall, so this is the larger of the two cases.
 */
const typicalStage = { width: 960, height: 640 };
// The margin Frame.svelte keeps round the frame on its stage.
const stageMargin = 16;

export function readabilityOf(size: DrawnSize, ratio: FrameRatio): Readability {
  const { frame, fit } = size;
  const stage = Math.min(
    (typicalStage.width - 2 * stageMargin) / frame.width,
    (typicalStage.height - 2 * stageMargin) / frame.height
  );
  const scale = fit * stage;
  return {
    ratio,
    frame,
    content: size.content,
    parts: size.parts,
    row: size.row,
    scale,
    text: size.text.typical * scale,
    smallest: size.text.smallest * scale
  };
}
