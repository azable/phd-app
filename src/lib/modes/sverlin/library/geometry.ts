/**
 * The layouts every step is drawn with (see LayoutMemory), as data: worked out once, on the server
 * (see ../layout.server.ts) or in the page, and given to the page, which then mounts only the step
 * it shows. What showing reads: each node's least size, each component's box, each free layout's
 * solution over every step, the smallest fit any step needs, and the links drawn as one line.
 */

import { snappedBorder } from './model/look';
import type { Reservation } from './model/reserve';
import type { SpanLayout } from './node/span';
import type { Layouts } from './steps';

type Size = { width: number; height: number };

/** Raised whenever what geometry holds, or how it is read, changes. */
export const geometryVersion = 1;

export type Geometry = {
  version: number;
  /** The embedded fonts it was measured in (see ../fonts), which the page must draw with. */
  fonts: string;
  /**
   * The device pixel ratio it was laid out at, and every border width as written: borders snap to
   * device pixels, so it holds for a page at any ratio where each snaps to the same width.
   */
  devicePixelRatio: number;
  borders: number[];
  reserved: [string, Size][];
  components: [string, Size][];
  spans: [string, SpanLayout][];
  /** The smallest fit any step needs (see Frame.svelte); none for a presentation with no step. */
  fit?: number;
  lines: string[];
  reservation?: Reservation;
};

export function geometryOf(
  layouts: Layouts,
  drawn: Pick<Geometry, 'fonts' | 'devicePixelRatio'> & { borders: Iterable<number> },
  reservation?: Reservation
): Geometry {
  const fits = [...layouts.fits.values()];
  return {
    version: geometryVersion,
    fonts: drawn.fonts,
    devicePixelRatio: drawn.devicePixelRatio,
    borders: [...drawn.borders].sort((a, b) => a - b),
    reserved: [...layouts.reserved],
    components: [...layouts.components],
    spans: [...layouts.scopes].flatMap(([scope, { span }]) =>
      span ? [[scope, span] as [string, SpanLayout]] : []
    ),
    ...(fits.length ? { fit: Math.min(...fits) } : {}),
    lines: [...layouts.lines],
    ...(reservation ? { reservation } : {})
  };
}

/**
 * The geometry, of those given, a page can draw with: made for the fonts it draws in, and at a
 * device pixel ratio every border snaps alike at as at its own.
 */
export function geometryFor(
  given: unknown,
  fonts: string | undefined,
  devicePixelRatio: number
): Geometry | undefined {
  if (!Array.isArray(given) || fonts === undefined) return undefined;
  return (given as Partial<Geometry>[]).find(
    (geometry): geometry is Geometry =>
      geometry?.version === geometryVersion &&
      geometry.fonts === fonts &&
      typeof geometry.devicePixelRatio === 'number' &&
      Array.isArray(geometry.borders) &&
      geometry.borders.every(
        (width) =>
          snappedBorder(width, devicePixelRatio) ===
          snappedBorder(width, geometry.devicePixelRatio as number)
      )
  );
}

export function applyGeometry(layouts: Layouts, geometry: Geometry): void {
  for (const [id, size] of geometry.reserved) layouts.reserved.set(id, size);
  for (const [name, size] of geometry.components) layouts.components.set(name, size);
  for (const [scope, span] of geometry.spans)
    layouts.scopes.set(scope, { inputs: new Map(), span });
  if (geometry.fit !== undefined) layouts.fits.set(0, geometry.fit);
  for (const pair of geometry.lines) layouts.lines.add(pair);
}
