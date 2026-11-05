/**
 * A presentation's PDF made on the server, with no browser: from the scenes the layout model draws
 * (see ../library/model/scene-of.ts), the fonts read from the app's own files, and CSS colours
 * worked out without a canvas (see colour.ts).
 */

import type { SceneFrame, SceneStep } from '../library';
import type { SverlinScene } from '../scene';
import { cssColour } from '../library/colour';
import { renderPdf, type PdfResources } from './pdf';

const embedded = import.meta.glob<string>('../fonts/*.ttf', {
  query: '?inline',
  import: 'default',
  eager: true
});
// DejaVu, for characters no embedded face has, loaded only when a PDF needs it.
const dejaVu: Record<string, () => Promise<{ default: string }>> = {
  DejaVuSans: () => import('dejavu-fonts-ttf/ttf/DejaVuSans.ttf?inline'),
  'DejaVuSans-Bold': () => import('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?inline'),
  DejaVuSerif: () => import('dejavu-fonts-ttf/ttf/DejaVuSerif.ttf?inline'),
  'DejaVuSerif-Bold': () => import('dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf?inline'),
  DejaVuSansMono: () => import('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?inline'),
  'DejaVuSansMono-Bold': () => import('dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?inline')
};

const bytesOf = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;

export const serverPdfResources: PdfResources = {
  async font(file) {
    const own = embedded[`../fonts/${file}.ttf`];
    if (own) return bytesOf(own);
    const load = dejaVu[file];
    if (!load) throw new Error(`The font ${file} could not be loaded.`);
    return bytesOf((await load()).default);
  },
  colour: cssColour
};

/** The scene a render target reads, from the scenes drawn on the server and the version's labels. */
export function serverScene(
  scenes: { frame: SceneFrame; steps: SceneStep[] },
  version: Pick<SverlinScene, 'presentationId' | 'seed' | 'variant'> & { labels: string[] }
): SverlinScene {
  const { presentationId, seed, variant, labels } = version;
  return {
    format: 'sverlin-scene-v1',
    presentationId,
    seed,
    ...(variant ? { variant } : {}),
    frame: scenes.frame,
    steps: scenes.steps.map((step, index) => ({ ...step, label: labels[index] ?? '' }))
  };
}

/** A presentation's PDF from the scenes drawn on the server. */
export function serverPdf(scene: SverlinScene): Promise<Blob> {
  return renderPdf(scene, serverPdfResources);
}
