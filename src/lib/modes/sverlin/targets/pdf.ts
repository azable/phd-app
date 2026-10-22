/**
 * A PDF with a page per step, drawn from scene data: each page is the frame at its logical size,
 * and the document outline names each step by its number and label. Text is set in the
 * DejaVu fonts, embedded so every character the page showed can be drawn, and each line is
 * centred on where the page put it, narrowed when the font sets it wider than the page did.
 */

import { GState, jsPDF } from 'jspdf';

import type { SceneLink, SceneNode, SceneText } from '../library';
import { linkDashes } from '../library/node/design';
import type { SverlinScene } from '../scene';

export type FontFamily = 'sans' | 'serif' | 'mono';
type Rgba = [number, number, number, number];

/** What drawing needs from where it runs: font files, and CSS colours as RGBA. */
export type PdfResources = {
  font: (file: string) => Promise<ArrayBuffer>;
  colour: (css: string) => Rgba;
};

/** The DejaVu font files for each family, regular and bold, from the dejavu-fonts-ttf package. */
export const fontFiles: Record<FontFamily, { normal: string; bold: string }> = {
  sans: { normal: 'DejaVuSans.ttf', bold: 'DejaVuSans-Bold.ttf' },
  serif: { normal: 'DejaVuSerif.ttf', bold: 'DejaVuSerif-Bold.ttf' },
  mono: { normal: 'DejaVuSansMono.ttf', bold: 'DejaVuSansMono-Bold.ttf' }
};

// CSS pixels are 1/96 inch and PDF points 1/72, so a pixel is three quarters of a point.
const pointsPerPixel = 0.75;
// DejaVu's ascent and descent as fractions of its size (hhea: 1901 and 483 of 2048 units), which
// place a baseline so the font's height is centred on the line the page measured.
const ascent = 1901 / 2048;
const descent = 483 / 2048;
// The size of the notice on a page whose step could not be drawn.
const errorSize = 12;

/** The family a CSS font list asks for first. */
export function fontFamily(css: string): FontFamily {
  const first = css
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/gu, '')
    .toLowerCase();
  if (/mono|menlo|consolas|courier/u.test(first)) return 'mono';
  if (/^(ui-)?serif$|georgia|times/u.test(first)) return 'serif';
  return 'sans';
}

const fontStyle = (weight: number) => (weight >= 600 ? 'bold' : 'normal');

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In chunks, since spreading a whole font into one call exceeds the argument limit.
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

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

  // Only the fonts the scene uses are embedded.
  const used = new Set<string>();
  for (const step of scene.steps) {
    if (step.error) used.add('sans normal');
    for (const node of step.nodes)
      for (const run of node.runs ?? [])
        used.add(`${fontFamily(run.font)} ${fontStyle(run.fontWeight)}`);
    for (const link of step.links)
      if (link.label) used.add(`${fontFamily(link.label.font)} normal`);
  }
  await Promise.all(
    [...used].map(async (font) => {
      const [family, style] = font.split(' ') as [FontFamily, 'normal' | 'bold'];
      const file = fontFiles[family][style];
      doc.addFileToVFS(file, base64(await resources.font(file)));
      doc.addFont(file, family, style);
    })
  );

  const states = new Map<number, GState>();
  /** Draw what follows at an opacity, such as a faded node's and its colour's alpha together. */
  function setOpacity(opacity: number) {
    const level = Math.round(Math.min(Math.max(opacity, 0), 1) * 100) / 100;
    if (!states.has(level))
      states.set(level, new GState({ opacity: level, 'stroke-opacity': level }));
    doc.setGState(states.get(level));
  }
  const px = (value: number) => value * pointsPerPixel;

  /** Text centred on a point, narrowed to fit a width if it is wider, or only its outline. */
  function drawText(
    run: Pick<SceneText, 'text' | 'font' | 'fontSize' | 'fontWeight'>,
    centre: { x: number; y: number },
    { fit, outline = false }: { fit?: number; outline?: boolean } = {}
  ) {
    doc.setFont(fontFamily(run.font), fontStyle(run.fontWeight));
    doc.setFontSize(px(run.fontSize));
    const measured = doc.getTextWidth(run.text);
    const scale = fit && measured > px(fit) ? px(fit) / measured : 1;
    const baseline = centre.y + ((ascent - descent) / 2) * run.fontSize;
    doc.text(run.text, px(centre.x) - (measured * scale) / 2, px(baseline), {
      ...(scale < 1 ? { horizontalScale: scale } : {}),
      ...(outline ? { renderingMode: 'stroke' as const } : {})
    });
  }

  function drawNode(node: SceneNode, opacity: number) {
    const { box, look } = node;
    const radius = look.radius ?? 0;
    if (look.fill) {
      const [r, g, b, a] = resources.colour(look.fill);
      setOpacity(opacity * a);
      doc.setFillColor(r, g, b);
      if (radius)
        doc.roundedRect(
          px(box.x),
          px(box.y),
          px(box.width),
          px(box.height),
          px(radius),
          px(radius),
          'F'
        );
      else doc.rect(px(box.x), px(box.y), px(box.width), px(box.height), 'F');
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
      drawText(run, centre, { fit: run.box.width });
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
    const [start, first, second, end] = link.curve;
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
    doc.moveTo(px(start.x), px(start.y));
    doc.curveTo(px(first.x), px(first.y), px(second.x), px(second.y), px(end.x), px(end.y));
    doc.stroke();
    setStrokeStyle(undefined);
    if (link.directed && link.arrowSize) {
      // The head points along the curve where it ends: from the last control point that differs.
      const from = [second, first, start].find(({ x, y }) => x !== end.x || y !== end.y) ?? start;
      const length = Math.hypot(end.x - from.x, end.y - from.y) || 1;
      const [dx, dy] = [(end.x - from.x) / length, (end.y - from.y) / length];
      const size = link.arrowSize;
      const back = { x: end.x - dx * size, y: end.y - dy * size };
      doc.triangle(
        px(end.x),
        px(end.y),
        px(back.x - (dy * size) / 2),
        px(back.y + (dx * size) / 2),
        px(back.x + (dy * size) / 2),
        px(back.y - (dx * size) / 2),
        'F'
      );
    }
    if (link.label) {
      const label = { ...link.label, fontWeight: 400 };
      const [lr, lg, lb, la] = resources.colour(link.label.color);
      setOpacity(la);
      // A halo in the frame's colour keeps the label readable over the curve, as on the page.
      const [hr, hg, hb] = resources.colour(frame.background);
      doc.setDrawColor(hr, hg, hb);
      doc.setLineWidth(px(4));
      doc.setLineJoin('round');
      doc.setTextColor(lr, lg, lb);
      drawText(label, link.label.at, { outline: true });
      drawText(label, link.label.at);
    }
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
        { text: step.error, font: 'sans-serif', fontSize: errorSize, fontWeight: 400 },
        { x: frame.width / 2, y: frame.height / 2 },
        { fit: frame.width - 48 }
      );
    }
    doc.outline.add(null, `${index + 1}. ${step.label}`, { pageNumber: index + 1 });
  });
  return doc.output('blob');
}
