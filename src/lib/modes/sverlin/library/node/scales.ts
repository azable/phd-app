/** How layout settings and the page frame turn into CSS. */

import type { FrameRatio } from './props';

export const alignments = { start: 'flex-start', center: 'center', end: 'flex-end' };
export const justifications = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly'
};

// The page frame lays out at this logical width, with its height from the ratio, then scales to fit.
export const frameWidth = 1200;
export const frameRatios: Record<FrameRatio, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16
};
