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
import type { DrawnSummary } from './library/drawing';
import type { Geometry } from './library/geometry';
import { snappedBorder } from './library/model/look';

export type ServerLayout = {
  /**
   * Every step's layout at each device pixel ratio borders snap differently at, of 1 and 2, as on
   * most screens; none where the server could not lay the presentation out, which fails its build.
   */
  geometries?: Geometry[];
  /**
   * What each step draws, as a key alike for steps drawing the same picture (see recordLayouts);
   * none where the server could not lay the presentation out.
   */
  drawn?: string[];
  /** What the step drawing the most draws, for the assistant (see library/drawing.ts). */
  drawing?: DrawnSummary;
  /** How large it draws (see readability.server.ts); none where the server could not lay it out. */
  size?: DrawnSize;
  /** Why it could not. */
  failure?: string;
  /** Steps the view failed to draw, with why. */
  errors: string[];
  ms: number;
  /** Whether it was laid out before, by what it is made from. */
  cached: boolean;
};

type Size = { width: number; height: number };

/**
 * How large a presentation draws, unscaled: the frame every step shows in and the fit it shows
 * at, as the page draws them (see Geometry's frame); the largest content of any step; the parts of
 * the step needing the most room, side by side in a row or one above another; and the text sizes,
 * the smallest and the median by characters.
 */
export type DrawnSize = {
  frame: Size;
  fit: number;
  content: Size;
  parts: Size[];
  row: boolean;
  text: { smallest: number; typical: number };
};

/** How much memory and time a presentation's layout may take. */
export type Limits = { memoryMb: number; loadMs: number; layOutMs: number };
// Loading the presentation's code, and laying out every step at one device pixel ratio: Dijkstra's
// 97 steps take under a second on a laptop, so the times leave room for a busy server and a slower
// one. The memory bounds one presentation's markup and layouts, which stay far under it, so one
// that runs away stops before it takes the web process's own memory. One over a limit fails its
// build, to be drawn smaller (see build.server.ts).
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
        (await layOut.apply(undefined, [devicePixelRatio], {
          timeout: within.layOutMs,
          result: { promise: true, copy: true }
        })) as string
      ) as Geometry;
    const geometries = [await at(1)];
    const drawnJson = await global.get('__sverlinDrawn', { copy: true });
    const drawn = typeof drawnJson === 'string' ? (JSON.parse(drawnJson) as string[]) : undefined;
    const drawingJson = await global.get('__sverlinDrawing', { copy: true });
    const drawing =
      typeof drawingJson === 'string' ? (JSON.parse(drawingJson) as DrawnSummary) : undefined;
    const sizeJson = await global.get('__sverlinSize', { copy: true });
    const size = typeof sizeJson === 'string' ? (JSON.parse(sizeJson) as DrawnSize) : undefined;
    // Most screens draw at 1 or 2 device pixels a CSS pixel; at 2 a border of half a pixel, or one
    // and a half, keeps its width, where at 1 it snaps to a whole one.
    if (geometries[0].borders.some((width) => snappedBorder(width, 2) !== snappedBorder(width, 1)))
      geometries.push(await at(2));
    if (measure.missing.size)
      return {
        errors,
        failure: `no embedded font has ${[...measure.missing].slice(0, 10).join(' ')}`
      };
    return {
      geometries,
      ...(drawn ? { drawn } : {}),
      ...(drawing ? { drawing } : {}),
      ...(size ? { size } : {}),
      errors
    };
  } catch (cause) {
    return { errors, failure: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    // One over its memory is disposed of already.
    if (!isolate.isDisposed) isolate.dispose();
  }
}

/**
 * Why the server could not lay a presentation out, as what to change: one too large or slow to lay
 * out within the limits, or with a layout over the bundle's limit, draws less; one with characters
 * no embedded font has uses others; and the steps the view failed to draw.
 */
export function layoutFailureMessage(
  failure = 'no layout came back',
  errors: readonly string[] = []
): string {
  const failed = errors.length ? ` The view failed to draw at ${errors.join('; ')}.` : '';
  const missing = /^no embedded font has (.*)$/u.exec(failure);
  if (missing)
    return `The presentation draws characters no embedded font has (${missing[1]}): use other characters, as plain letters, digits and common symbols, or words.${failed}`;
  if (/time|memory|disposed|limit/iu.test(failure))
    return `The presentation is too large or slow to lay out (${failure}): draw fewer parts, or fewer steps, as a smaller input or a variant pausing at fewer labels.${failed}`;
  return `The presentation could not be laid out (${failure}).${failed}`;
}

/** The steps the view failed to draw, each reason once with the steps it stopped. */
export function drawFailureMessage(errors: readonly string[]): string {
  const stepsBy = new Map<string, string[]>();
  for (const error of errors) {
    const [, step, message] = /^step (\d+): (.*)$/su.exec(error) ?? [undefined, undefined, error];
    const reason = message.replace(/\.$/u, '');
    const steps = stepsBy.get(reason) ?? [];
    if (step && !steps.includes(step)) steps.push(step);
    stepsBy.set(reason, steps);
  }
  const reasons = [...stepsBy].map(([message, steps]) =>
    steps.length ? `at step${steps.length > 1 ? 's' : ''} ${steps.join(', ')}: ${message}` : message
  );
  return `The view failed to draw ${reasons.join('; ')}. A step it fails at shows nothing: correct the view so it draws every step.`;
}
