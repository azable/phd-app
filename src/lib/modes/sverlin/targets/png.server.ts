/**
 * Pictures of scenes as PNG data URLs, made on the server with no browser and no system package:
 * the server PDF (pdf.server.ts), a page per step, drawn by pdf.js (`pdfjs-dist`) on the canvas it
 * uses in Node (`@napi-rs/canvas`, which ships its own binaries), so any host with Node, Render
 * included, makes them. Only this file knows how; swapping in another rasteriser (resvg, say)
 * changes nothing else.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { SceneFrame, SceneStep } from '../library';
import { serverPdf, serverScene } from './pdf.server';

type NodeCanvas = { toBuffer(mime: 'image/png'): Buffer };

/**
 * A PNG of each step of `scenes`, `width` pixels wide (as the step shows on the stage), as data
 * URLs in step order.
 */
export async function scenePictures(
  scenes: { frame: SceneFrame; steps: SceneStep[] },
  width: number
): Promise<string[]> {
  const pdf = await serverPdf(
    serverScene(scenes, { presentationId: 'pictures', seed: 0, labels: [] })
  );
  const loading = getDocument({
    data: new Uint8Array(await pdf.arrayBuffer()),
    isEvalSupported: false
  });
  const document = await loading.promise;
  try {
    const pictures: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const { canvas } = document.canvasFactory.create(
        Math.round(viewport.width),
        Math.round(viewport.height)
      ) as { canvas: HTMLCanvasElement & NodeCanvas };
      await page.render({ canvas, viewport }).promise;
      pictures.push(`data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`);
      page.cleanup();
    }
    return pictures;
  } finally {
    await loading.destroy();
  }
}
