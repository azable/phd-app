/**
 * Columns of the source as written, where a rewrite made a line longer: a layout's tag becomes a
 * render longer than the tag, and a part's closing a snippet's, one longer (see
 * layout-tags.server.ts). Lines never move, so a position keeps its line; one after such a rewrite
 * on its line is mapped back by what the rewrites before it added. The shifts are those of the
 * source being prepared, which is prepared synchronously, set for its preparation and then cleared.
 */

/** On a line, where a rewrite ends in the source as rewritten, and how much longer it made it. */
export type ColumnShift = { line: number; end: number; added: number };

let shifts: readonly ColumnShift[] = [];

/** Run `prepare` with the shifts of the source it prepares, so positions name it as written. */
export function withColumnShifts<T>(given: readonly ColumnShift[], prepare: () => T): T {
  const before = shifts;
  shifts = given;
  try {
    return prepare();
  } finally {
    shifts = before;
  }
}

/** A 0-based column of the source as rewritten, on a 1-based line, as the source was written. */
export function writtenColumn(line: number, column: number): number {
  let written = column;
  for (const shift of shifts)
    if (shift.line === line && column >= shift.end) written -= shift.added;
  return written;
}
