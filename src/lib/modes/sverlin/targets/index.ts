/** The files a Sverlin presentation can be exported as, each rendered from its scene data. */

import monoBold from 'dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url';
import mono from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import sansBold from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';
import sans from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import serifBold from 'dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf?url';
import serif from 'dejavu-fonts-ttf/ttf/DejaVuSerif.ttf?url';

import type { RenderedFile, RenderTarget } from '../../render-targets';
import type { SverlinScene } from '../scene';
import type { PdfResources } from './pdf';

export type SverlinTarget = RenderTarget & {
  render: (scene: SverlinScene) => Promise<RenderedFile>;
};

// Served as assets of the app and fetched only when a PDF uses them.
const fontUrls: Record<string, string> = {
  'DejaVuSans.ttf': sans,
  'DejaVuSans-Bold.ttf': sansBold,
  'DejaVuSerif.ttf': serif,
  'DejaVuSerif-Bold.ttf': serifBold,
  'DejaVuSansMono.ttf': mono,
  'DejaVuSansMono-Bold.ttf': monoBold
};

function browserResources(): PdfResources {
  // A pixel painted in a colour reads back as RGBA, whatever CSS syntax the page computed it in.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const colours = new Map<string, [number, number, number, number]>();
  return {
    async font(file) {
      const response = await fetch(fontUrls[file]);
      if (!response.ok) throw new Error(`The font ${file} could not be loaded.`);
      return response.arrayBuffer();
    },
    colour(css) {
      const known = colours.get(css);
      if (known) return known;
      if (!context) return [0, 0, 0, 1];
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      const rgba: [number, number, number, number] = [r, g, b, a / 255];
      colours.set(css, rgba);
      return rgba;
    }
  };
}

const fileName = (scene: SverlinScene, extension: string) =>
  `sverlin-${scene.presentationId.slice(0, 8)}-seed-${scene.seed}.${extension}`;

export const sverlinTargets: SverlinTarget[] = [
  {
    id: 'pdf',
    title: 'PDF, a page per step',
    animated: false,
    async render(scene: SverlinScene): Promise<RenderedFile> {
      // jsPDF is large, so it loads only when a PDF is made.
      const { renderPdf } = await import('./pdf');
      return { name: fileName(scene, 'pdf'), blob: await renderPdf(scene, browserResources()) };
    }
  },
  {
    id: 'scene',
    title: 'Scene data (JSON)',
    animated: false,
    async render(scene: SverlinScene): Promise<RenderedFile> {
      return {
        name: fileName(scene, 'scene.json'),
        blob: new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
      };
    }
  }
];
