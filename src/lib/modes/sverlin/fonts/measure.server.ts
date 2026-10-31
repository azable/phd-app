/**
 * Text widths and font metrics on the server, from the very font files every page embeds (see
 * README.md), shaped by HarfBuzz as the page's text is: each character in the first face of its
 * font list that has it, each run of characters in one face shaped alone, at the size in CSS pixels.
 * The faces carry no hinting, so every browser takes the same unhinted advances. A character no
 * embedded face in its list has is drawn by the page in a font of its machine, which nothing here
 * can know, so the measure says so (see `missing`).
 */

import * as hb from 'harfbuzzjs';

import type { TextMeasure } from '../library/model/layout';
import manifest from './faces.json';

const files = import.meta.glob<string>('./*.ttf', {
  query: '?inline',
  import: 'default',
  eager: true
});

type Face = { face: hb.Face; upem: number; hhea: DataView; has: Set<number> };

/** The font list's faces by family, lower case, and weight, read once. */
let faces: Map<string, Map<number, Face>> | undefined;
function facesByFamily(): Map<string, Map<number, Face>> {
  if (faces) return faces;
  faces = new Map();
  for (const { file, family, weight } of manifest.faces) {
    const data = files[`./${file}.ttf`];
    if (!data) throw new Error(`Embedded font ${file}.ttf is missing.`);
    const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    const face = new hb.Face(new hb.Blob(bytes.buffer), 0);
    // A copy, as a table read from HarfBuzz's memory goes when that memory grows.
    const hhea = face.referenceTable('hhea')?.slice();
    if (!hhea) throw new Error(`Embedded font ${file}.ttf has no hhea table.`);
    const weights = faces.get(family.toLowerCase()) ?? new Map<number, Face>();
    weights.set(weight, {
      face,
      upem: face.upem,
      hhea: new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength),
      has: new Set(face.collectUnicodes())
    });
    faces.set(family.toLowerCase(), weights);
  }
  return faces;
}

/** The embedded fonts' version, which pages laid out with this measure must draw in. */
export const fontsVersion = manifest.version;

type Font = { faces: Face[]; size: number };

/** A CSS font as the layout model writes one: style, weight, size in pixels and family list. */
function parseFont(font: string): Font {
  const match = /^(\S+) (\S+) ([\d.e+-]+)px (.*)$/u.exec(font);
  if (!match) throw new Error(`Unreadable font ${font}`);
  const [, , weightText, size, list] = match;
  const asked = weightText === 'bold' ? 700 : weightText === 'normal' ? 400 : Number(weightText);
  // As CSS matches weights among the two each family has: 600 and over take the bold face.
  const weight = asked >= 600 ? 700 : 400;
  const families = facesByFamily();
  const chosen: Face[] = [];
  for (const name of list.split(',')) {
    const family = name
      .trim()
      .replace(/^['"]|['"]$/gu, '')
      .toLowerCase();
    const face = families.get(family)?.get(weight);
    // The first family that is not embedded ends the list: the page goes on to its machine's.
    if (!face) break;
    chosen.push(face);
  }
  // Sizes in whole 64ths of a pixel, toward zero, as FreeType takes them, so a size such as 13.6px
  // draws at 13.59375px; whole and half pixels, as nearly every size is, are unchanged.
  return { faces: chosen, size: Math.floor(Number(size) * 64) / 64 };
}

export type ServerMeasure = TextMeasure & {
  /** Characters some text asked for that no embedded face in its list has. */
  missing: Set<string>;
};

export function serverMeasure(): ServerMeasure {
  const missing = new Set<string>();
  const fonts = new Map<string, Font>();
  const fontOf = (font: string) => {
    let known = fonts.get(font);
    if (!known) fonts.set(font, (known = parseFont(font)));
    return known;
  };
  const sized = new Map<Face, Map<number, hb.Font>>();
  const sizedFont = (face: Face, size: number) => {
    let bySize = sized.get(face);
    if (!bySize) sized.set(face, (bySize = new Map()));
    let font = bySize.get(size);
    if (!font) {
      font = new hb.Font(face.face);
      // The size in 16.16 fixed point, so advances come back in 65536ths of a pixel.
      const scale = Math.round(size * 65536);
      font.setScale(scale, scale);
      bySize.set(size, font);
    }
    return font;
  };
  const advance = (face: Face, size: number, text: string) => {
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(sizedFont(face, size), buffer);
    let sum = 0;
    for (const { xAdvance } of buffer.getGlyphPositions()) sum += xAdvance / 65536;
    return sum;
  };
  const widths = new Map<string, number>();
  const metrics = new Map<string, ReturnType<TextMeasure['metrics']>>();
  return {
    missing,
    width(text, font) {
      const key = `${font}\n${text}`;
      let width = widths.get(key);
      if (width !== undefined) return width;
      const { faces: list, size } = fontOf(font);
      // Runs of characters drawn in one face, each shaped alone, as the page falls back by run.
      width = 0;
      let run = '';
      let runFace: Face | undefined;
      for (const character of text) {
        const code = character.codePointAt(0) as number;
        const face = list.find(({ has }) => has.has(code)) ?? runFace ?? list[0];
        if (!list.some(({ has }) => has.has(code)) && !/\s/u.test(character))
          missing.add(character);
        if (face !== runFace && run && runFace) {
          width += advance(runFace, size, run);
          run = '';
        }
        runFace = face;
        run += character;
      }
      if (run && runFace) width += advance(runFace, size, run);
      widths.set(key, width);
      return width;
    },
    metrics(font) {
      let known = metrics.get(font);
      if (known) return known;
      const { faces: list, size } = fontOf(font);
      const primary = list[0];
      if (!primary) {
        missing.add(`(${font})`);
        return { ascent: 0, descent: 0, xHeight: 0 };
      }
      // Ascent and descent from hhea, rounded, as the page takes them; the x-height from the x's
      // bounds in the first face that has one, rounded out.
      const scale = size / primary.upem;
      const xFace = list.find(({ has }) => has.has(0x78)) ?? primary;
      const sizedX = sizedFont(xFace, size);
      const buffer = new hb.Buffer();
      buffer.addText('x');
      buffer.guessSegmentProperties();
      hb.shape(sizedX, buffer);
      const glyph = buffer.getGlyphInfos()[0]?.codepoint ?? 0;
      const extents = sizedX.glyphExtents(glyph);
      known = {
        ascent: Math.round(primary.hhea.getInt16(4) * scale),
        descent: Math.round(-primary.hhea.getInt16(6) * scale),
        xHeight: Math.ceil((extents?.yBearing ?? 0) / 65536)
      };
      metrics.set(font, known);
      return known;
    }
  };
}
