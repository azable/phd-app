/**
 * Pictures of scenes as PNG data URLs, made on the server with no browser: the server PDF
 * (pdf.server.ts), a page per step, turned into PNGs by poppler's `pdftoppm`, which devenv.nix
 * provides. Only this file knows how; swapping in another rasteriser (resvg, say) changes nothing
 * else. Where `pdftoppm` is missing, as on a host without poppler, it throws
 * PicturesUnavailableError and the caller goes on without pictures.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { SceneFrame, SceneStep } from '../library';
import { serverPdf, serverScene } from './pdf.server';

const run = promisify(execFile);

export class PicturesUnavailableError extends Error {}

/**
 * How long one conversion may take. A three-page PDF converted in about 0.2 s on a laptop on
 * 2026-11-06; ten seconds leaves room for a busy server and never holds a turn up for long.
 */
const conversionTimeoutMs = 10_000;

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
  const folder = await mkdtemp(join(tmpdir(), 'sverlin-pictures-'));
  try {
    const file = join(folder, 'scenes.pdf');
    await writeFile(file, Buffer.from(await pdf.arrayBuffer()));
    try {
      await run(
        'pdftoppm',
        [
          '-png',
          '-scale-to-x',
          String(Math.round(width)),
          '-scale-to-y',
          '-1',
          file,
          join(folder, 'step')
        ],
        { timeout: conversionTimeoutMs }
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
        throw new PicturesUnavailableError('pdftoppm (poppler) is not installed.');
      throw cause;
    }
    // pdftoppm numbers its pages with as many digits as the last needs, so a name sort keeps order.
    const pages = (await readdir(folder)).filter((name) => name.endsWith('.png')).sort();
    return Promise.all(
      pages.map(
        async (page) =>
          `data:image/png;base64,${(await readFile(join(folder, page))).toString('base64')}`
      )
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
