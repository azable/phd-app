/**
 * Every step's layout worked out on the server, so the page mounts only the step it shows (see
 * assembly/entry.ts). The presentation's own code draws its steps, so it runs in an isolate:
 * nothing of Node is in it, its memory and time are bounded, and it ends with each call. The host
 * measures text in the fonts every page embeds (see fonts/measure.server.ts), and keeps what it
 * worked out by what it was made from, so the same presentation is laid out once.
 */

import { createHash } from 'node:crypto';

import ivm from 'isolated-vm';

import type { DesignValue } from './design.server';
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

/**
 * A presentation's layout code loaded in a fresh isolate, with the host's text measure: `at` lays
 * every step out at a device pixel ratio, with design values in place of the variant's where given,
 * and `read` copies out what the last layout left in a global. The caller disposes of the isolate.
 */
async function loadIsolated(code: string, within: Limits, errors: string[]) {
  const measure = serverMeasure();
  const isolate = new ivm.Isolate({ memoryLimit: within.memoryMb });
  const dispose = () => {
    // One over its memory is disposed of already.
    if (!isolate.isDisposed) isolate.dispose();
  };
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
    const at = async (devicePixelRatio: number, design?: Record<string, DesignValue>) =>
      JSON.parse(
        (await layOut.apply(
          undefined,
          design ? [devicePixelRatio, JSON.stringify(design)] : [devicePixelRatio],
          { timeout: within.layOutMs, result: { promise: true, copy: true } }
        )) as string
      ) as Geometry;
    const read = async <T>(name: string): Promise<T | undefined> => {
      const json = await global.get(name, { copy: true });
      return typeof json === 'string' ? (JSON.parse(json) as T) : undefined;
    };
    return { at, read, measure, dispose };
  } catch (cause) {
    dispose();
    throw cause;
  }
}

async function layOutIsolated(
  code: string,
  within: Limits
): Promise<Omit<ServerLayout, 'ms' | 'cached'>> {
  const errors: string[] = [];
  let loaded: Awaited<ReturnType<typeof loadIsolated>> | undefined;
  try {
    loaded = await loadIsolated(code, within, errors);
    const { at, read, measure } = loaded;
    const geometries = [await at(1)];
    const drawn = await read<string[]>('__sverlinDrawn');
    const drawing = await read<DrawnSummary>('__sverlinDrawing');
    const size = await read<DrawnSize>('__sverlinSize');
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
    loaded?.dispose();
  }
}

/** One other arrangement of a presentation's free layouts: the values set, and how it draws. */
export type MeasuredArrangement = {
  values: Record<string, DesignValue>;
  size: DrawnSize;
  /** Pairs of links whose straight lines cross, over every free layout. */
  crossings: number;
};

/**
 * Lays a presentation out again with each set of design values in place of its variant's, in one
 * isolate, at one device pixel ratio, measuring each as the presentation's own size is measured,
 * and counting where its free layouts' links cross; stops once `budgetMs` has passed, and leaves
 * out a set that fails to lay out or places every free layout's children as one already `seen`
 * does (see arrangementSignature), as a form that has no effect on a structure. Sets of one
 * `group`, as the seeds of one layout, stop at the first drawn alike: a layout its seed does not
 * move draws alike at every seed.
 */
export async function arrangementsOnServer(
  code: string,
  designs: readonly Record<string, DesignValue>[],
  budgetMs: number,
  seen = new Set<string>(),
  group: (values: Record<string, DesignValue>) => string | undefined = () => undefined,
  within = limits
): Promise<MeasuredArrangement[]> {
  const started = performance.now();
  const errors: string[] = [];
  const measured: MeasuredArrangement[] = [];
  const settled = new Set<string>();
  let loaded: Awaited<ReturnType<typeof loadIsolated>> | undefined;
  try {
    loaded = await loadIsolated(code, within, errors);
    for (const values of designs) {
      if (performance.now() - started > budgetMs) break;
      const among = group(values);
      if (among !== undefined && settled.has(among)) continue;
      const failed = errors.length;
      const geometry = await loaded.at(1, values).catch(() => undefined);
      const size = await loaded.read<DrawnSize>('__sverlinSize');
      if (!geometry || !size || errors.length > failed) continue;
      const signature = arrangementSignature(geometry);
      if (seen.has(signature)) {
        if (among !== undefined) settled.add(among);
        continue;
      }
      seen.add(signature);
      measured.push({ values, size, crossings: crossingsOf(geometry) });
    }
  } catch {
    // An isolate that will not load, or runs out of memory, measures nothing more.
  } finally {
    loaded?.dispose();
  }
  return measured;
}

/** Where every free layout places its children, to the pixel: alike for arrangements drawn alike. */
export function arrangementSignature(geometry: Pick<Geometry, 'spans'>): string {
  return JSON.stringify(
    geometry.spans.map(([scope, { positions }]) => [
      scope,
      Object.entries(positions).map(([key, { x, y }]) => [key, Math.round(x), Math.round(y)])
    ])
  );
}

/**
 * Pairs of links, in every free layout, whose straight lines between their ends cross; links
 * sharing an end never count, as their lines meet there.
 */
export function crossingsOf(geometry: Pick<Geometry, 'spans'>): number {
  let count = 0;
  for (const [, { edges }] of geometry.spans)
    for (let a = 0; a < edges.length; a++)
      for (let b = a + 1; b < edges.length; b++) if (cross(edges[a], edges[b])) count++;
  return count;
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

function cross(a: Segment, b: Segment): boolean {
  const near = (x1: number, y1: number, x2: number, y2: number) =>
    Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1;
  const ends = [
    [a.x1, a.y1],
    [a.x2, a.y2]
  ];
  const others = [
    [b.x1, b.y1],
    [b.x2, b.y2]
  ];
  if (ends.some(([x, y]) => others.some(([u, v]) => near(x, y, u, v)))) return false;
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return (
    side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1) * side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2) < 0 &&
    side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1) * side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2) < 0
  );
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
