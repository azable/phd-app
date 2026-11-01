/**
 * A PDF with a page per step, drawn from scene data: each page is the frame at its logical size,
 * and the document outline names each step by its number and label. Text is set in the faces the
 * page drew it in (see ../fonts), embedded in the PDF, each character in the first face of its font
 * list that has it, as the page falls back, and in DejaVu when none of them has it, where the page
 * went on to a font of its machine. Each line is centred on where the page put it, and narrowed if
 * it is set wider, as jsPDF does not kern; its case is set as the page draws it, small capitals at
 * 0.7 of the size, and its decoration is a line under or through it. PDF has no blur, so a box's
 * shadow is an offset copy of its shape behind it (soft and lifted a light fill, hard a solid
 * block), and its glow a larger, faint copy; a hatched fill is drawn as lines over it, kept inside
 * the box.
 */

import { GState, jsPDF } from 'jspdf';

import manifest from '../fonts/faces.json';
import type { SceneBox, SceneHead, SceneLink, SceneNode, SceneText } from '../library';
import { pageFont } from '../library/fonts';
import { casedRuns, smallCapsScale } from '../library/model/text-case';
import { fillPatterns, glowHalo, linkDashes, shadows } from '../library/node/design';
import { headDrawing } from '../library/node/heads';
import type { SverlinScene } from '../scene';

type DejaVuFamily = 'sans' | 'serif' | 'mono';
type Rgba = [number, number, number, number];

/** What drawing needs from where it runs: font files by name, without `.ttf`, and CSS colours. */
export type PdfResources = {
  font: (file: string) => Promise<ArrayBuffer>;
  colour: (css: string) => Rgba;
};

/** The DejaVu files for each family, regular and bold, from the dejavu-fonts-ttf package. */
const dejaVuFiles: Record<DejaVuFamily, { normal: string; bold: string }> = {
  sans: { normal: 'DejaVuSans', bold: 'DejaVuSans-Bold' },
  serif: { normal: 'DejaVuSerif', bold: 'DejaVuSerif-Bold' },
  mono: { normal: 'DejaVuSansMono', bold: 'DejaVuSansMono-Bold' }
};

// CSS pixels are 1/96 inch and PDF points 1/72, so a pixel is three quarters of a point.
const pointsPerPixel = 0.75;
// The size of the notice on a page whose step could not be drawn.
const errorSize = 12;

const embeddedFonts = new Map(manifest.fonts.map((font) => [font.family.toLowerCase(), font]));
/** Each embedded face's file, by its family in lower case and weight. */
const embeddedFaces = new Map(
  manifest.faces.map(({ file, family, weight }) => [`${family.toLowerCase()} ${weight}`, file])
);
/** Each face's name in the PDF, as its /BaseFont: its family and weight, or DejaVu's file. */
const fontNames = new Map(
  manifest.faces.map(({ file, family, weight }) => [
    file,
    `${family.replaceAll(' ', '')}-${weight >= 600 ? 'Bold' : 'Regular'}`
  ])
);
const fontName = (file: string) => fontNames.get(file) ?? file;

/** The DejaVu family nearest a font the page took from its machine. */
function dejaVuFamily(family: string): DejaVuFamily {
  if (/mono|menlo|consolas|courier/u.test(family)) return 'mono';
  if (/^(ui-)?serif$|georgia|times/u.test(family)) return 'serif';
  return 'sans';
}

/**
 * The faces a text is drawn in, in the order its characters try them: the embedded faces its CSS
 * font list starts with, at the weight the page took (600 and over the bold face), then the DejaVu
 * face nearest its family, for what none of them has.
 */
export function faceFiles(css: string, weight: number): string[] {
  const bold = weight >= 600;
  const names = css.split(',').map((name) =>
    name
      .trim()
      .replace(/^['"]|['"]$/gu, '')
      .toLowerCase()
  );
  const files: string[] = [];
  for (const name of names) {
    const file = embeddedFaces.get(`${name} ${bold ? 700 : 400}`);
    // The first family that is not embedded ends the list: the page goes on to its machine's.
    if (!file) break;
    files.push(file);
  }
  const family = (embeddedFonts.get(names[0])?.pdf as DejaVuFamily) ?? dejaVuFamily(names[0]);
  files.push(dejaVuFiles[family][bold ? 'bold' : 'normal']);
  return files;
}

/**
 * A text split into runs of characters each drawn in one face: the first face that has the
 * character, or, when none has it (whitespace among them), the face of the run it is in.
 */
export function fallbackRuns<Face>(
  text: string,
  faces: readonly Face[],
  has: (face: Face, character: string) => boolean
): { face: Face; text: string }[] {
  const runs: { face: Face; text: string }[] = [];
  for (const character of text) {
    const last = runs.at(-1);
    const face = faces.find((candidate) => has(candidate, character)) ?? last?.face ?? faces[0];
    if (last?.face === face) last.text += character;
    else runs.push({ face, text: character });
  }
  return runs;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In chunks, since spreading a whole font into one call exceeds the argument limit.
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** The parts of jsPDF's reading of a TrueType file that drawing takes. */
type FaceData = {
  characterToGlyph: (code: number) => number;
  head: { unitsPerEm: number };
  hhea: { ascender: number; decender: number };
};

/** The notice on a page whose step could not be drawn, in the page's font. */
const errorText = (text: string) => ({
  text,
  font: pageFont,
  fontSize: errorSize,
  fontWeight: 400
});

export async function renderPdf(scene: SverlinScene, resources: PdfResources): Promise<Blob> {
  const { frame } = scene;
  const width = frame.width * pointsPerPixel;
  const height = frame.height * pointsPerPixel;
  const doc = new jsPDF({
    unit: 'pt',
    format: [width, height],
    orientation: width >= height ? 'landscape' : 'portrait',
    compress: true
  });
  doc.setProperties({
    title: `Sverlin presentation ${scene.presentationId.slice(0, 8)}, seed ${scene.seed}`,
    creator: 'Sverlin'
  });

  // Each face is embedded once, and only if some character is drawn in it: a text's first face,
  // and each further one only if the faces before it lack one of the text's characters.
  const faces = new Map<string, FaceData>();
  const has = (file: string, character: string) => {
    const code = character.codePointAt(0) as number;
    // jsPDF encodes text by UTF-16 unit, so it draws no character beyond them.
    return code <= 0xffff && (faces.get(file)?.characterToGlyph(code) ?? 0) !== 0;
  };
  const texts = scene.steps.flatMap((step) => [
    ...step.nodes.flatMap((node) => node.runs ?? []),
    ...(step.error ? [errorText(step.error)] : [])
  ]);
  const chains = texts.map(({ text, font, fontWeight }) => ({
    text,
    files: faceFiles(font, fontWeight)
  }));
  for (let depth = 0; chains.some(({ files }) => depth < files.length); depth++) {
    const needed = chains
      .filter(
        ({ text, files }) =>
          depth < files.length &&
          (depth === 0 ||
            [...text].some(
              (character) =>
                !/\s/u.test(character) &&
                !files.slice(0, depth).some((file) => has(file, character))
            ))
      )
      .map(({ files }) => files[depth])
      .filter((file) => !faces.has(file));
    const loaded = await Promise.all(
      [...new Set(needed)].map(async (file) => [file, base64(await resources.font(file))] as const)
    );
    for (const [file, data] of loaded) {
      doc.addFileToVFS(`${file}.ttf`, data);
      doc.addFont(`${file}.ttf`, fontName(file), 'normal', 'Identity-H');
      doc.setFont(fontName(file), 'normal');
      faces.set(file, doc.getFont().metadata as FaceData);
    }
  }

  const states = new Map<number, GState>();
  /** Draw what follows at an opacity, such as a faded node's and its colour's alpha together. */
  function setOpacity(opacity: number) {
    const level = Math.round(Math.min(Math.max(opacity, 0), 1) * 100) / 100;
    if (!states.has(level))
      states.set(level, new GState({ opacity: level, 'stroke-opacity': level }));
    doc.setGState(states.get(level));
  }
  const px = (value: number) => value * pointsPerPixel;

  /**
   * Text centred on a point, its line's height centred there by its first face's ascent and
   * descent, as the page measured them, and narrowed to fit a width if it is wider; where it went,
   * in points, for a line along it.
   */
  function drawText(
    run: Pick<SceneText, 'text' | 'font' | 'fontSize' | 'fontWeight' | 'case'>,
    centre: { x: number; y: number },
    { fit }: { fit?: number } = {}
  ): { left: number; right: number; baseline: number } {
    const files = faceFiles(run.font, run.fontWeight).filter((file) => faces.has(file));
    // Small capitals at their share of the size, unrounded, as the run's size is already scaled.
    const pieces = casedRuns(run.text, run.case).flatMap(({ text, small }) => {
      const size = px(small ? run.fontSize * smallCapsScale : run.fontSize);
      doc.setFontSize(size);
      return fallbackRuns(text, files, has).map((piece) => {
        doc.setFont(fontName(piece.face), 'normal');
        return { ...piece, size, width: doc.getTextWidth(piece.text) };
      });
    });
    const measured = pieces.reduce((sum, { width }) => sum + width, 0);
    const scale = fit && measured > px(fit) ? px(fit) / measured : 1;
    const { head, hhea } = faces.get(files[0]) as FaceData;
    // Rounded to whole pixels, as the page takes them (see ../fonts/measure.server.ts).
    const ascent = Math.round((hhea.ascender * run.fontSize) / head.unitsPerEm);
    const descent = Math.round((-hhea.decender * run.fontSize) / head.unitsPerEm);
    const baseline = px(centre.y + (ascent - descent) / 2);
    const left = px(centre.x) - (measured * scale) / 2;
    let x = left;
    for (const piece of pieces) {
      doc.setFont(fontName(piece.face), 'normal');
      doc.setFontSize(piece.size);
      doc.text(piece.text, x, baseline, scale < 1 ? { horizontalScale: scale } : {});
      x += piece.width * scale;
    }
    return { left, right: x, baseline };
  }

  /** A box's outline as a path, filled, stroked, or left to clip by (null). */
  function boxPath(box: SceneBox, radius: number, style: 'F' | 'S' | null) {
    if (radius)
      doc.roundedRect(
        px(box.x),
        px(box.y),
        px(box.width),
        px(box.height),
        px(radius),
        px(radius),
        style
      );
    else doc.rect(px(box.x), px(box.y), px(box.width), px(box.height), style);
  }

  /** Fill a box's shape in a colour, at an opacity times the colour's alpha and a share. */
  function fillBox(box: SceneBox, radius: number, css: string, opacity: number, share = 1) {
    const [r, g, b, a] = resources.colour(css);
    setOpacity(opacity * a * share);
    doc.setFillColor(r, g, b);
    boxPath(box, radius, 'F');
  }

  /** The glow and shadow behind a box, as it is drawn on the page round it. */
  function drawEffects(node: SceneNode, opacity: number) {
    const { box, look } = node;
    const radius = look.radius ?? 0;
    if (look.glow) {
      const reach = glowHalo.spread + glowHalo.blur / 2;
      const halo = {
        x: box.x - reach,
        y: box.y - reach,
        width: box.width + 2 * reach,
        height: box.height + 2 * reach
      };
      fillBox(halo, radius + reach, look.glow, opacity, glowHalo.alpha / 2);
    }
    if (look.shadow) {
      const { x, y, alpha } = shadows[look.shadow];
      const behind = { ...box, x: box.x + x, y: box.y + y };
      if (look.shadow === 'hard') fillBox(behind, radius, look.stroke ?? look.color, opacity);
      else fillBox(behind, radius, 'black', opacity, alpha);
    }
  }

  /** A hatched fill's lines over it, inside the box. */
  function drawFillStyle(node: SceneNode, opacity: number) {
    const { box, look } = node;
    if (look.fillStyle !== 'hatched') return;
    doc.saveGraphicsState();
    boxPath(box, look.radius ?? 0, null);
    doc.clip();
    doc.discardPath();
    const { line, spacing, alpha } = fillPatterns.hatch;
    const [r, g, b] = resources.colour('black');
    setOpacity(opacity * alpha);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(px(line));
    // Lines from top left to bottom right, as the page's stripes at 45 degrees, spacing apart.
    const step = spacing * Math.SQRT2;
    for (let start = box.x - box.height; start < box.x + box.width; start += step)
      doc.line(px(start), px(box.y), px(start + box.height), px(box.y + box.height));
    doc.restoreGraphicsState();
  }

  /** A line under or through a run of text, in its colour, as thick as the page's would be. */
  function drawDecoration(
    run: SceneText,
    { left, right, baseline }: { left: number; right: number; baseline: number }
  ) {
    if (!run.decoration) return;
    const [r, g, b] = resources.colour(run.color);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(px(Math.max(1, run.fontSize / 16)));
    // About where fonts put their underline, and the middle of a lower-case letter.
    const y =
      baseline + px(run.decoration === 'underline' ? run.fontSize * 0.1 : -run.fontSize * 0.27);
    doc.line(left, y, right, y);
  }

  function drawNode(node: SceneNode, opacity: number) {
    const { box, look } = node;
    const radius = look.radius ?? 0;
    drawEffects(node, opacity);
    if (look.fill) {
      fillBox(box, radius, look.fill, opacity);
      drawFillStyle(node, opacity);
    }
    if (look.stroke && look.strokeWidth) {
      // A CSS border lies inside the box, and a PDF stroke on both sides of its path.
      const inset = look.strokeWidth / 2;
      const [r, g, b, a] = resources.colour(look.stroke);
      setOpacity(opacity * a);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(px(look.strokeWidth));
      // A browser's dashes and dots grow with the border's width, near these.
      const width = look.strokeWidth;
      setStrokeStyle(look.strokeStyle, { dashed: [3 * width, 2 * width], dotted: [0, 2 * width] });
      const [x, y, w, h] = [
        box.x + inset,
        box.y + inset,
        box.width - 2 * inset,
        box.height - 2 * inset
      ];
      const corner = Math.max(0, radius - inset);
      if (corner) doc.roundedRect(px(x), px(y), px(w), px(h), px(corner), px(corner), 'S');
      else doc.rect(px(x), px(y), px(w), px(h), 'S');
      setStrokeStyle(undefined);
    }
    for (const run of node.runs ?? []) {
      const [r, g, b, a] = resources.colour(run.color);
      setOpacity(opacity * a);
      doc.setTextColor(r, g, b);
      const centre = { x: run.box.x + run.box.width / 2, y: run.box.y + run.box.height / 2 };
      drawDecoration(run, drawText(run, centre, { fit: run.box.width }));
    }
  }

  /** Dash the lines drawn next, dots with round caps, by a pattern in frame pixels; solid without. */
  function setStrokeStyle(
    style: 'dashed' | 'dotted' | undefined,
    patterns?: Record<'dashed' | 'dotted', readonly number[]>
  ) {
    doc.setLineDashPattern(style && patterns ? patterns[style].map(px) : [], 0);
    doc.setLineCap(style === 'dotted' ? 'round' : 'butt');
  }

  function drawLink(link: SceneLink) {
    const [r, g, b, a] = resources.colour(link.stroke);
    setOpacity(a);
    doc.setDrawColor(r, g, b);
    doc.setFillColor(r, g, b);
    doc.setLineWidth(px(link.strokeWidth));
    // The page's dashes are in units of the curve, which grow with its stroke.
    const unit = link.strokeWidth / 1.5;
    setStrokeStyle(link.strokeStyle, {
      dashed: linkDashes.dashed.map((length) => length * unit),
      dotted: linkDashes.dotted.map((length) => length * unit)
    });
    if (link.curve) {
      const [start, first, second, end] = link.curve;
      doc.moveTo(px(start.x), px(start.y));
      doc.curveTo(px(first.x), px(first.y), px(second.x), px(second.y), px(end.x), px(end.y));
    } else if (link.wire) {
      const [start, ...rest] = link.wire;
      doc.moveTo(px(start.x), px(start.y));
      for (const corner of rest) doc.lineTo(px(corner.x), px(corner.y));
    }
    doc.stroke();
    setStrokeStyle(undefined);
    for (const head of [link.heads?.start, link.heads?.end]) if (head) drawHead(head, link);
  }

  /** A head, as the page draws its marker (see node/heads.ts): its 10 by 10 box laid along it. */
  function drawHead(head: SceneHead, link: SceneLink) {
    const drawing = headDrawing(head.shape);
    if (!drawing) return;
    const length = Math.hypot(head.tip.x - head.back.x, head.tip.y - head.back.y) || 1;
    const [dx, dy] = [(head.tip.x - head.back.x) / length, (head.tip.y - head.back.y) / length];
    const scale = head.size / 10;
    // A point of the box: along the line from the back, and across it from its middle.
    const at = (x: number, y: number) => ({
      x: px(head.back.x + dx * x * scale - dy * (y - 5) * scale),
      y: px(head.back.y + dy * x * scale + dx * (y - 5) * scale)
    });
    doc.setLineWidth(px(link.strokeWidth));
    doc.setLineJoin('round');
    doc.setLineCap('round');
    if (head.shape === 'dot') {
      const centre = at(5, 5);
      doc.circle(centre.x, centre.y, px(head.size / 2), 'F');
      return;
    }
    const points = [...drawing.path.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/gu)].map(([, x, y]) =>
      at(Number(x), Number(y))
    );
    const [first, ...rest] = points;
    doc.moveTo(first.x, first.y);
    for (const point of rest) doc.lineTo(point.x, point.y);
    if (drawing.path.endsWith('z')) doc.close();
    if (drawing.filled) doc.fill();
    else doc.stroke();
  }

  scene.steps.forEach((step, index) => {
    if (index) doc.addPage([width, height], width >= height ? 'landscape' : 'portrait');
    const [r, g, b] = resources.colour(frame.background);
    setOpacity(1);
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, px(frame.width), px(frame.height), 'F');
    // A nested node's opacity multiplies with its parents', which come before it.
    const opacities = new Map<string, number>();
    for (const node of step.nodes) {
      const opacity =
        (node.look.opacity ?? 1) * (node.parent ? (opacities.get(node.parent) ?? 1) : 1);
      opacities.set(node.id, opacity);
      drawNode(node, opacity);
    }
    for (const link of step.links) drawLink(link);
    if (step.error) {
      setOpacity(1);
      doc.setTextColor(185, 28, 28);
      drawText(
        errorText(step.error),
        { x: frame.width / 2, y: frame.height / 2 },
        { fit: frame.width - 48 }
      );
    }
    doc.outline.add(null, `${index + 1}. ${step.label}`, { pageNumber: index + 1 });
  });
  return doc.output('blob');
}
