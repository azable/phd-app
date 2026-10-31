// Spike (not for main): text widths and font metrics in Node, from font files, by five libraries,
// each as the layout model's TextMeasure (see library/model/layout.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { Canvas as SkiaCanvas, FontLibrary } from 'skia-canvas';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as fontkit from 'fontkit';
import fontverter from 'fontverter';
import * as hb from 'harfbuzzjs';
import opentype from 'opentype.js';

import type { TextMeasure } from './library/model/layout';

// The comparison libraries' font objects, untyped (see zz-spike-modules.d.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpikeFont = any;
export type Family = 'sans' | 'serif' | 'mono';
export type FontFile = { path: string; index?: number; variations?: Record<string, number> };
export type FontSet = Record<`${Family}-${400 | 700}`, FontFile>;

const S =
  '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
const modules = 'node_modules';

export const embeddedFonts: FontSet = {
  'sans-400': { path: `${modules}/@fontsource/inter/files/inter-latin-400-normal.woff2` },
  'sans-700': { path: `${modules}/@fontsource/inter/files/inter-latin-700-normal.woff2` },
  'serif-400': {
    path: `${modules}/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2`
  },
  'serif-700': {
    path: `${modules}/@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2`
  },
  'mono-400': {
    path: `${modules}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2`
  },
  'mono-700': {
    path: `${modules}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2`
  }
};

const store = '/nix/store/d6y8gycw6qr8dmalh79lr6sw87lpi5v4-home-manager-path/share/fonts';
const dejavu = '/nix/store/xadrivsjgk1bslbd64hq9zakin7vp6nr-dejavu-fonts-2.37/share/fonts/truetype';
/** The files this machine's fontconfig gives Chrome for system-ui, serif and monospace. */
export const systemFonts: FontSet = {
  'sans-400': { path: `${store}/truetype/Inter.ttc`, index: 0 },
  'sans-700': { path: `${store}/truetype/Inter.ttc`, index: 14 },
  // Chrome takes Times New Roman's metric-compatible alias, not fontconfig's serif.
  'serif-400': { path: `${store}/truetype/LiberationSerif-Regular.ttf` },
  'serif-700': { path: `${store}/truetype/LiberationSerif-Bold.ttf` },
  'mono-400': { path: `${dejavu}/DejaVuSansMono.ttf` },
  'mono-700': { path: `${dejavu}/DejaVuSansMono-Bold.ttf` }
};

/** A CSS font shorthand as the model writes it: style, weight, size in px, family list. */
export function parseFont(font: string): {
  family: Family;
  fallback?: Family;
  weight: 400 | 700;
  size: number;
} {
  const match = /^(\S+) (\S+) ([\d.]+)px (.*)$/u.exec(font);
  if (!match) throw new Error(`unparsed font ${font}`);
  const names = match[4]
    .split(',')
    .map((name) => name.trim().replace(/^['"]|['"]$/gu, '').toLowerCase());
  const familyOf = (name: string): Family =>
    /mono/u.test(name) ? 'mono' : /serif$/u.test(name) && !/sans/u.test(name) ? 'serif' : 'sans';
  const family = familyOf(names[0]);
  // The embedded face a missing character falls back to, as the page's font list names it.
  const second = names[1]?.startsWith('sverlin ') ? familyOf(names[1]) : undefined;
  const fallback = second !== family ? second : undefined;
  const weight = match[2] === 'bold' || Number(match[2]) >= 600 ? 700 : 400;
  return { family, fallback, weight, size: Number(match[3]) };
}

const sfntCache = new Map<string, Buffer>();
async function sfnt(file: FontFile): Promise<Buffer> {
  let known = sfntCache.get(file.path);
  if (!known) {
    const raw = readFileSync(file.path);
    known = file.path.endsWith('.woff2') ? Buffer.from(await fontverter.convert(raw, 'truetype')) : raw;
    sfntCache.set(file.path, known);
  }
  return known;
}

type Measurer = { name: string; measure: TextMeasure; covers(text: string, font: string): boolean };

function cached(widthOf: (text: string, font: string) => number, metricsOf: TextMeasure['metrics']): TextMeasure {
  const widths = new Map<string, number>();
  const metrics = new Map<string, ReturnType<TextMeasure['metrics']>>();
  return {
    width(text, font) {
      const key = `${font}\n${text}`;
      let width = widths.get(key);
      if (width === undefined) widths.set(key, (width = widthOf(text, font)));
      return width;
    },
    metrics(font) {
      let known = metrics.get(font);
      if (!known) metrics.set(font, (known = metricsOf(font)));
      return known;
    }
  };
}

export async function harfbuzz(fonts: FontSet): Promise<Measurer> {
  const faces = new Map<
    string,
    { face: hb.Face; upem: number; hinted: boolean; variations?: Record<string, number> }
  >();
  for (const [key, file] of Object.entries(fonts)) {
    const blob = new hb.Blob(new Uint8Array(await sfnt(file)).buffer);
    const face = new hb.Face(blob, file.index ?? 0);
    // A hinted font's advances come to the page in whole 64ths, as FreeType gives them.
    const hinted = face.referenceTable('fpgm') !== undefined;
    faces.set(key, { face, upem: face.upem, hinted, variations: file.variations });
  }
  const hintedFont = new Set<string>();
  // Tried and dropped: rounding hinted fonts' advances made system fonts worse (see the note).
  const roundHinted = false;
  const fontsAt = new Map<string, hb.Font>();
  const sized = (key: string, size: number) => {
    const cacheKey = `${key}@${size}`;
    let known = fontsAt.get(cacheKey);
    if (!known) {
      const { face, variations } = faces.get(key)!;
      known = new hb.Font(face);
      // As Blink sets it: the size in 16.16 fixed point.
      const scale = Math.round(size * 65536);
      known.setScale(scale, scale);
      if (variations)
        known.setVariations(
          Object.entries(variations).map(([tag, value]) => new hb.Variation(tag, value))
        );
      fontsAt.set(cacheKey, known);
    }
    return known;
  };
  const fontAt = (font: string) => {
    const { family, weight, size } = parseFont(font);
    if (faces.get(`${family}-${weight}`)!.hinted) hintedFont.add(font);
    return sized(`${family}-${weight}`, size);
  };
  const fallbackAt = (font: string) => {
    const { fallback, weight, size } = parseFont(font);
    return fallback ? sized(`${fallback}-${weight}`, size) : undefined;
  };
  const coverage = new Map<hb.Face, Set<number>>();
  const has = (font: hb.Font, character: string) => {
    let set = coverage.get(font.face);
    if (!set) coverage.set(font.face, (set = new Set(font.face.collectUnicodes())));
    return set.has(character.codePointAt(0)!);
  };
  const glyphOf = (font: hb.Font, character: string) => {
    const buffer = new hb.Buffer();
    buffer.addText(character);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    return buffer.getGlyphInfos()[0]?.codepoint ?? 0;
  };
  const advance = (f: hb.Font, text: string, whole: boolean) => {
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(f, buffer);
    let sum = 0;
    for (const { xAdvance } of buffer.getGlyphPositions())
      sum += whole && roundHinted ? Math.round(xAdvance / 1024) / 64 : xAdvance / 65536;
    return sum;
  };
  return {
    name: 'harfbuzzjs',
    covers: (text, font) => {
      const f = fontAt(font);
      const g = fallbackAt(font);
      return [...text].every((c) => c === ' ' || has(f, c) || (g !== undefined && has(g, c)));
    },
    measure: cached(
      (text, font) => {
        const f = fontAt(font);
        const g = fallbackAt(font);
        const whole = hintedFont.has(font);
        if (!g) return advance(f, text, whole);
        // Runs of characters the face has, and of those its fallback draws, each shaped alone.
        let sum = 0;
        let run = '';
        let inFallback = false;
        for (const c of text) {
          const fallsBack = c !== ' ' && !has(f, c) && has(g, c);
          if (fallsBack !== inFallback && run) {
            sum += advance(inFallback ? g : f, run, whole);
            run = '';
          }
          inFallback = fallsBack;
          run += c;
        }
        if (run) sum += advance(inFallback ? g : f, run, whole);
        return sum;
      },
      (font) => {
        const f = fontAt(font);
        const { size } = parseFont(font);
        // Ascent and descent from the hhea table, as FreeType gives them to the page.
        const hhea = f.face.referenceTable('hhea');
        const view = hhea && new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength);
        const extents = f.hExtents();
        const x = f.glyphExtents(glyphOf(f, 'x'));
        return {
          ascent: view
            ? Math.round((view.getInt16(4) * size) / f.face.upem)
            : Math.round(extents.ascender / 65536),
          descent: view
            ? Math.round((-view.getInt16(6) * size) / f.face.upem)
            : Math.round(-extents.descender / 65536),
          // Glyph bounds come back rounded out, as Skia gives them to the page.
          xHeight: Math.ceil((x?.yBearing ?? 0) / 65536)
        };
      }
    )
  };
}

export async function napiCanvas(fonts: FontSet): Promise<Measurer> {
  for (const [key, file] of Object.entries(fonts)) GlobalFonts.register(await sfnt(file), `SpikeNapi-${key}`);
  const context = createCanvas(10, 10).getContext('2d');
  context.fontKerning = 'normal';
  const use = (font: string) => {
    const { family, fallback, weight, size } = parseFont(font);
    context.font = `${size}px "SpikeNapi-${family}-${weight}"${fallback ? `, "SpikeNapi-${fallback}-${weight}"` : ''}`;
  };
  return {
    name: '@napi-rs/canvas',
    covers: () => true,
    measure: cached(
      (text, font) => {
        use(font);
        return context.measureText(text).width;
      },
      (font) => {
        use(font);
        const x = context.measureText('x');
        return {
          ascent: x.fontBoundingBoxAscent,
          descent: x.fontBoundingBoxDescent,
          xHeight: x.actualBoundingBoxAscent
        };
      }
    )
  };
}

export async function skiaCanvas(fonts: FontSet): Promise<Measurer> {
  mkdirSync(`${S}/s4/fonts`, { recursive: true });
  for (const [key, file] of Object.entries(fonts)) {
    const path = `${S}/s4/fonts/${key}-${file.path.split('/').pop()!.replace(/\.\w+$/u, '')}.ttf`;
    writeFileSync(path, await sfnt(file));
    FontLibrary.use(`SpikeSkia-${key}`, [path]);
  }
  const context = new SkiaCanvas(10, 10).getContext('2d');
  context.fontKerning = 'normal';
  const use = (font: string) => {
    const { family, weight, size } = parseFont(font);
    context.font = `${size}px "SpikeSkia-${family}-${weight}"`;
  };
  return {
    name: 'skia-canvas',
    covers: () => true,
    measure: cached(
      (text, font) => {
        use(font);
        return context.measureText(text).width;
      },
      (font) => {
        use(font);
        const x = context.measureText('x');
        return {
          ascent: x.fontBoundingBoxAscent,
          descent: x.fontBoundingBoxDescent,
          xHeight: x.actualBoundingBoxAscent
        };
      }
    )
  };
}

export async function fontkitMeasure(fonts: FontSet): Promise<Measurer> {
  const faces = new Map<string, SpikeFont>();
  for (const [key, file] of Object.entries(fonts)) {
    let font = fontkit.create(await sfnt(file)) as SpikeFont;
    if (font.fonts) font = font.fonts[file.index ?? 0];
    if (file.variations) font = font.getVariation(file.variations);
    faces.set(key, font);
  }
  const at = (font: string) => {
    const { family, weight, size } = parseFont(font);
    return { face: faces.get(`${family}-${weight}`)!, size };
  };
  return {
    name: 'fontkit',
    covers: (text, font) => [...text].every((c) => c === ' ' || at(font).face.hasGlyphForCodePoint(c.codePointAt(0)!)),
    measure: cached(
      (text, font) => {
        const { face, size } = at(font);
        const run = face.layout(text);
        return run.positions.reduce((sum: number, p: { xAdvance: number }) => sum + p.xAdvance, 0) * (size / face.unitsPerEm);
      },
      (font) => {
        const { face, size } = at(font);
        const x = face.glyphForCodePoint(120);
        return {
          ascent: Math.round((face.ascent * size) / face.unitsPerEm),
          descent: Math.round((-face.descent * size) / face.unitsPerEm),
          xHeight: Math.round((x.bbox.maxY * size) / face.unitsPerEm)
        };
      }
    )
  };
}

export async function opentypeMeasure(fonts: FontSet): Promise<Measurer> {
  const faces = new Map<string, SpikeFont>();
  for (const [key, file] of Object.entries(fonts)) {
    if (file.index || file.variations) continue;
    const buffer = await sfnt(file);
    faces.set(key, opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)));
  }
  const at = (font: string) => {
    const { family, weight, size } = parseFont(font);
    const face = faces.get(`${family}-${weight}`);
    if (!face) throw new Error(`opentype.js: no ${family}-${weight} (collections and variations unsupported)`);
    return { face, size };
  };
  return {
    name: 'opentype.js',
    covers: (text, font) => {
      try {
        at(font).face.getAdvanceWidth(text, 16, { kerning: true });
      } catch {
        return false;
      }
      return [...text].every((c) => c === ' ' || at(font).face.charToGlyphIndex(c) !== 0);
    },
    measure: cached(
      (text, font) => {
        const { face, size } = at(font);
        return face.getAdvanceWidth(text, size, { kerning: true });
      },
      (font) => {
        const { face, size } = at(font);
        const x = face.charToGlyph('x').getBoundingBox();
        return {
          ascent: Math.round((face.ascender * size) / face.unitsPerEm),
          descent: Math.round((-face.descender * size) / face.unitsPerEm),
          xHeight: Math.round((x.y2 * size) / face.unitsPerEm)
        };
      }
    )
  };
}

/** DejaVu, subset to Sverlin's character set (s4/subset.mjs), the same glyphs as the page's woff2. */
export const dejavuFonts: FontSet = Object.fromEntries(
  (['sans', 'serif', 'mono'] as const).flatMap((family) =>
    ([400, 700] as const).map((weight) => [
      `${family}-${weight}`,
      { path: `${S}/s4/subset/${family}-${weight}.ttf` }
    ])
  )
) as FontSet;
