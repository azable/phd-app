/**
 * Every step's layout worked out on the server, so the page mounts only the step it shows (see
 * assembly/entry.ts). The presentation's own code draws its steps, so it runs in an isolate:
 * nothing of Node is in it, its memory and time are bounded, and it ends with each call. The host
 * measures text in the fonts every page embeds (see fonts/measure.server.ts), and keeps what it
 * worked out by what it was made from, so the same presentation is laid out once.
 */

import { createHash } from 'node:crypto';

import ivm from 'isolated-vm';

import { fontsVersion, serverMeasure } from './fonts/measure.server';
import type { Geometry } from './library/geometry';
import { snappedBorder } from './library/model/look';

export type ServerLayout = {
  /**
   * Every step's layout at each device pixel ratio borders snap differently at, of 1 and 2, as on
   * most screens; none where the server could not lay the presentation out, and the page then does.
   */
  geometries?: Geometry[];
  /** Why it could not. */
  failure?: string;
  /** Steps the view failed to draw, with why. */
  errors: string[];
  ms: number;
  /** Whether it was laid out before, by what it is made from. */
  cached: boolean;
};

/** How much memory and time a presentation's layout may take. */
export type Limits = { memoryMb: number; loadMs: number; layOutMs: number };
// Loading the presentation's code, and laying out every step at one device pixel ratio: Dijkstra's
// 97 steps take under a second on a laptop.
const limits: Limits = { memoryMb: 256, loadMs: 10_000, layOutMs: 60_000 };

/**
 * Layouts by what they were made from: the server bundle (its steps, view, variant and library),
 * the fonts, and how text is measured in them. The newest are kept.
 */
const kept = new Map<string, ServerLayout>();
const keptMost = 64;
// Raised whenever the measure changes how it reads the same fonts.
const measureVersion = 1;

export async function layOutOnServer(code: string, within = limits): Promise<ServerLayout> {
  const started = performance.now();
  const key = createHash('sha256')
    .update(`${fontsVersion}\n${measureVersion}\n`)
    .update(code)
    .digest('hex');
  const known = kept.get(key);
  if (known) {
    kept.delete(key);
    kept.set(key, known);
    return { ...known, cached: true, ms: Math.round(performance.now() - started) };
  }
  const laid = await layOutIsolated(code, within);
  const result = { ...laid, cached: false, ms: Math.round(performance.now() - started) };
  // A failure such as a time-out may pass on a less busy server, so only results are kept.
  if (result.geometries) {
    kept.set(key, result);
    if (kept.size > keptMost) kept.delete(kept.keys().next().value as string);
  }
  return result;
}

async function layOutIsolated(
  code: string,
  within: Limits
): Promise<Omit<ServerLayout, 'ms' | 'cached'>> {
  const errors: string[] = [];
  const measure = serverMeasure();
  const isolate = new ivm.Isolate({ memoryLimit: within.memoryMb });
  try {
    const context = await isolate.createContext();
    const global = context.global;
    await global.set(
      '__hostWidth',
      new ivm.Callback((text: string, font: string) => measure.width(text, font))
    );
    await global.set(
      '__hostMetrics',
      new ivm.Callback((font: string) => JSON.stringify(measure.metrics(font)))
    );
    await global.set(
      '__hostReport',
      new ivm.Callback((message: string, step?: number) => {
        if (errors.length < 20)
          errors.push(step === undefined ? message : `step ${step + 1}: ${message}`);
      })
    );
    await context.eval(
      `globalThis.__sverlinHost = {
        width: (text, font) => __hostWidth(text, font),
        metrics: (font) => JSON.parse(__hostMetrics(font)),
        report: (message, step) => __hostReport(message, step)
      };`
    );
    const script = await isolate.compileScript(code);
    await script.run(context, { timeout: within.loadMs });
    const layOut = await global.get('__sverlinLayOut', { reference: true });
    const at = async (devicePixelRatio: number) =>
      JSON.parse(
        (await layOut.apply(undefined, [fontsVersion, devicePixelRatio], {
          timeout: within.layOutMs,
          result: { promise: true, copy: true }
        })) as string
      ) as Geometry;
    const geometries = [await at(1)];
    // Most screens draw at 1 or 2 device pixels a CSS pixel; at 2 a border of half a pixel, or one
    // and a half, keeps its width, where at 1 it snaps to a whole one.
    if (geometries[0].borders.some((width) => snappedBorder(width, 2) !== snappedBorder(width, 1)))
      geometries.push(await at(2));
    if (measure.missing.size)
      return {
        errors,
        failure: `no embedded font has ${[...measure.missing].slice(0, 10).join(' ')}`
      };
    return { geometries, errors };
  } catch (cause) {
    return { errors, failure: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    // One over its memory is disposed of already.
    if (!isolate.isDisposed) isolate.dispose();
  }
}
