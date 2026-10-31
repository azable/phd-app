/** Text widths and font metrics from a canvas, as the page's own text is drawn (see layout.ts). */

import type { TextMeasure } from './layout';

export function canvasMeasure(): TextMeasure {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Layout model: no canvas to measure text with');
  // Without it, kerning next to spaces is skipped, unlike the page's text.
  context.fontKerning = 'normal';
  // Spike: every width and metric measured, kept on the page for the server-layout comparison.
  const kept = globalThis as typeof globalThis & {
    __svWidths?: Map<string, number>;
    __svMetrics?: Map<string, ReturnType<TextMeasure['metrics']>>;
  };
  const widths = (kept.__svWidths ??= new Map<string, number>());
  const metrics = (kept.__svMetrics ??= new Map<string, ReturnType<TextMeasure['metrics']>>());
  const use = (font: string) => {
    if (context.font !== font) context.font = font;
  };
  return {
    width(text, font) {
      const key = `${font}\n${text}`;
      let width = widths.get(key);
      if (width === undefined) {
        use(font);
        widths.set(key, (width = context.measureText(text).width));
      }
      return width;
    },
    metrics(font) {
      let known = metrics.get(font);
      if (!known) {
        use(font);
        const x = context.measureText('x');
        known = {
          ascent: x.fontBoundingBoxAscent,
          descent: x.fontBoundingBoxDescent,
          xHeight: x.actualBoundingBoxAscent
        };
        metrics.set(font, known);
      }
      return known;
    }
  };
}
