/**
 * The layouts every step is drawn with (see LayoutMemory), as data, worked out once on the server
 * (see ../layout.server.ts), which its scenes are drawn from: each node's least size, each grid's
 * tracks, each component's box, each free layout's solution over every step, the frame and the
 * fit every step shows at, and the links drawn as one line.
 */

import type { ShownFrame } from './fit';
import type { Reservation } from './model/reserve';
import type { ArrangeEdge } from './node/arrange';
import type { SpanLayout } from './node/span';
import type { Layouts } from './steps';

type Size = { width: number; height: number };

/** Raised whenever what geometry holds, or how it is read, changes. */
export const geometryVersion = 6;

export type Geometry = {
  version: number;
  /**
   * The device pixel ratio it was laid out at, and every border width as written: borders snap to
   * device pixels, so it holds for a page at any ratio where each snaps to the same width.
   */
  devicePixelRatio: number;
  borders: number[];
  reserved: [string, Size][];
  tracks: [string, { columns: number[]; rows: number[]; start?: [number, number] }][];
  components: [string, Size][];
  spans: [string, SpanLayout][];
  /** The frame every step shows in, and its fit (see shownFrame); none with no step. */
  frame?: ShownFrame;
  lines: string[];
  reservation?: Reservation;
  /**
   * Each free layout's links as drawn at each state, by scope: each set of links with the states
   * that draw it (see LayoutMemory.routes).
   */
  routes?: [string, [number[], ArrangeEdge[]][]][];
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
    ...(reservation ? { reservation } : {}),
    ...(layouts.routes?.size ? { routes: groupedRoutes(layouts.routes) } : {})
  };
}

/** Routes by scope, each set of links once with every state drawing it. */
function groupedRoutes(routes: NonNullable<Layouts['routes']>): NonNullable<Geometry['routes']> {
  return [...routes].map(([scope, states]) => {
    const sets = new Map<ArrangeEdge[], number[]>();
    for (const [state, edges] of states) sets.set(edges, [...(sets.get(edges) ?? []), state]);
    return [scope, [...sets].map(([edges, drawing]) => [drawing, edges])];
  });
}
