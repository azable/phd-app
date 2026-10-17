/** Theme palette colours for fills, strokes, and text; other values pass through as CSS colours. */

import type { NodeColor, PaletteColor } from './props';

const palette: Record<PaletteColor, { fill: string; stroke: string; text: string }> = {
  neutral: { fill: 'var(--sv-surface)', stroke: 'var(--sv-line)', text: 'var(--sv-muted)' },
  blue: { fill: 'var(--sv-blue)', stroke: 'var(--sv-blue-line)', text: 'var(--sv-blue-line)' },
  green: { fill: 'var(--sv-green)', stroke: 'var(--sv-green-line)', text: 'var(--sv-green-line)' },
  amber: { fill: 'var(--sv-amber)', stroke: 'var(--sv-amber-line)', text: 'var(--sv-amber-line)' },
  red: { fill: 'var(--sv-red)', stroke: 'var(--sv-red-line)', text: 'var(--sv-red-line)' },
  purple: {
    fill: 'var(--sv-purple)',
    stroke: 'var(--sv-purple-line)',
    text: 'var(--sv-purple-line)'
  }
};

/** The CSS colour for a use: a palette shade, or the value itself. */
export function paletteColor(
  color: NodeColor | undefined,
  use: 'fill' | 'stroke' | 'text'
): string | undefined {
  if (color === undefined) return undefined;
  return Object.hasOwn(palette, color) ? palette[color as PaletteColor][use] : color;
}

/** The palette name a colour was given as, if it is one, so scene data keeps what a colour means. */
export function paletteName(color: unknown): PaletteColor | undefined {
  return typeof color === 'string' && Object.hasOwn(palette, color)
    ? (color as PaletteColor)
    : undefined;
}
