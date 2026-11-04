/**
 * The design's fonts, as the embedded fonts' manifest lists them (see ../fonts/README.md): each
 * value's font list, its embedded face first, the embedded fallback second and the icons third, and
 * the rules that draw a node or listing in it, part of the page's style sheet (see page.ts).
 */

import manifest from '../fonts/faces.json';

/** The design's font values, the first the starter's and the page's own. */
export const fontValues = manifest.fonts.map(({ value }) => value);

/** A font value's CSS font list. */
export function fontList(value: string): string {
  const font = manifest.fonts.find((candidate) => candidate.value === value);
  if (!font) throw new Error(`No font ${value}`);
  return `'${font.family}', '${manifest.fallback}', '${manifest.iconFamily}', ${font.fallbacks}`;
}

/** The font list every text not given another is drawn in. */
export const pageFont = fontList(fontValues[0]);

/** The icons a view may bind to its value, as <Node icon={this} />, in the order the design offers them. */
export const iconNames: readonly string[] = Object.keys(manifest.icons);

/** The character an icon is drawn as, in the icon face, or undefined for no icon. */
export const iconGlyph = (name: unknown): string | undefined => {
  const code =
    typeof name === 'string' ? (manifest.icons as Record<string, string>)[name] : undefined;
  return code === undefined ? undefined : String.fromCodePoint(parseInt(code, 16));
};

/** The class that draws an element in a font value, as a node's `font` or a listing's text. */
export const fontClass = (value: string): string => `sv-font-${value}`;

export const fontCss = fontValues
  .map((value) => `.${fontClass(value)} { font-family: ${fontList(value)}; }`)
  .join('\n');
