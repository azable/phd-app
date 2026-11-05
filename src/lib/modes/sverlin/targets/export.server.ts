/**
 * A version exported as one of its render targets on the server, from the scenes the server draws
 * of it (see ../scenes.server.ts), so no export is made in the browser.
 */

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import type { ExportedFile } from '../../server';
import { versionScenes } from '../scenes.server';
import { exportName } from './index';
import { serverPdf, serverScene } from './pdf.server';

export async function exportFile(
  presentation: BrowserBundlePresentation,
  target: string
): Promise<ExportedFile | undefined> {
  if (target !== 'pdf' && target !== 'scene') return undefined;
  const scene = serverScene(await versionScenes(presentation), presentation);
  const name = (extension: string) =>
    exportName(presentation.presentationId, presentation.seed, extension);
  return target === 'pdf'
    ? {
        name: name('pdf'),
        contentType: 'application/pdf',
        body: new Uint8Array(await (await serverPdf(scene)).arrayBuffer())
      }
    : {
        name: name('scene.json'),
        contentType: 'application/json',
        body: new TextEncoder().encode(JSON.stringify(scene, null, 2))
      };
}
