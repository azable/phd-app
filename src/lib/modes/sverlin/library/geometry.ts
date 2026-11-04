/**
 * The layouts every step is drawn with (see LayoutMemory), as data: worked out once, on the server
 * (see ../layout.server.ts), and given to the page, which then mounts only the step it shows. What
 * showing reads: each node's least size, each grid's tracks, each component's box, each free
 * layout's solution over every step, the frame and the fit every step shows at, and the links
 * drawn as one line.
 */

import type { ShownFrame } from './fit';
import { snappedBorder } from './model/look';
import type { Reservation } from './model/reserve';
import type { SpanLayout } from './node/span';
import type { Layouts } from './steps';

type Size = { width: number; height: number };

/** Raised whenever what geometry holds, or how it is read, changes. */
export const geometryVersion = 4;

export type Geometry = {
  version: number;
  /**
   * The device pixel ratio it was laid out at, and every border width as written: borders snap to
   * device pixels, so it holds for a page at any ratio where each snaps to the same width.
   */
  devicePixelRatio: number;
  borders: number[];
  reserved: [string, Size][];
  tracks: [string, { columns: number[]; rows: number[] }][];
  components: [string, Size][];
  spans: [string, SpanLayout][];
  /** The frame every step shows in, and its fit (see shownFrame); none with no step. */
  frame?: ShownFrame;
  lines: string[];
  reservation?: Reservation;
};

export function geometryOf(
  layouts: Layouts,
  drawn: Pick<Geometry, 'devicePixelRatio'> & { borders: Iterable<number> },
  frame?: ShownFrame,
  reservation?: Reservation
): Geometry {
  return {
    version: geometryVersion,
    devicePixelRatio: drawn.devicePixelRatio,
    borders: [...drawn.borders].sort((a, b) => a - b),
    reserved: [...layouts.reserved],
    tracks: [...layouts.tracks],
    components: [...layouts.components],
    spans: [...layouts.scopes].flatMap(([scope, { span }]) =>
      span ? [[scope, span] as [string, SpanLayout]] : []
    ),
    ...(frame ? { frame } : {}),
    lines: [...layouts.lines],
    ...(reservation ? { reservation } : {})
  };
}

/**
 * The geometry, of those given, a page draws with: one made at a device pixel ratio every border
 * snaps alike at as at its own, or else the one made at the ratio nearest its own; none where none
 * of this version was given.
 */
export function geometryFor(given: unknown, devicePixelRatio: number): Geometry | undefined {
  if (!Array.isArray(given)) return undefined;
  const usable = (given as Partial<Geometry>[]).filter(
    (geometry): geometry is Geometry =>
      geometry?.version === geometryVersion &&
      typeof geometry.devicePixelRatio === 'number' &&
      Array.isArray(geometry.borders)
  );
  const alike = usable.find((geometry) =>
    geometry.borders.every(
      (width) =>
        snappedBorder(width, devicePixelRatio) === snappedBorder(width, geometry.devicePixelRatio)
    )
  );
  const distance = (geometry: Geometry) => Math.abs(geometry.devicePixelRatio - devicePixelRatio);
  return alike ?? usable.toSorted((a, b) => distance(a) - distance(b))[0];
}

export function applyGeometry(layouts: Layouts, geometry: Geometry): void {
  for (const [id, size] of geometry.reserved) layouts.reserved.set(id, size);
  for (const [id, tracks] of geometry.tracks) layouts.tracks.set(id, tracks);
  for (const [name, size] of geometry.components) layouts.components.set(name, size);
  for (const [scope, span] of geometry.spans)
    layouts.scopes.set(scope, { inputs: new Map(), span });
  if (geometry.frame) layouts.frame = geometry.frame;
  for (const pair of geometry.lines) layouts.lines.add(pair);
}
