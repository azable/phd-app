/**
 * Where a selected element came from: the <Node> or <Link> tag its id names in the presentation's source
 * (see provideNodeIds in library/type-context.ts for how ids are formed).
 */

export type ElementLocation = {
  /** Line and column (both from 1) of the element's <Node> or <Link> tag. */
  line: number;
  column: number;
  /** A keyed node's key, which names the element whichever render of the tag drew it. */
  key?: string;
  /** Which render of that tag (and key) it was, from 1, such as the third time round a loop. */
  occurrence: number;
  /** Item indices within collections that drew the element themselves, outermost first. */
  items: number[];
  /** The source line holding the tag, trimmed and shortened. */
  markup: string;
};

// The key is URL-encoded (see keyedRef in library/type-context.ts).
const elementId =
  /^(\d{1,5}):(\d{1,5})(?:@([\w.!~*'()%-]{1,24}))?(?:#(\d{1,5}))?((?:\/\d{1,5}){0,8})$/u;
const maxMarkup = 200;

/** Locate an element id in a Sverlin source, or undefined if it names no <Node> or <Link> there. */
export function locateElement(source: string, id: string): ElementLocation | undefined {
  const match = elementId.exec(id);
  if (!match) return undefined;
  const line = Number(match[1]);
  const column = Number(match[2]);
  const text = source.split('\n')[line - 1];
  if (text === undefined || !/^<(?:Node|Link)(?:[\s/>]|$)/u.test(text.slice(column - 1)))
    return undefined;
  let key: string | undefined;
  try {
    key = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
  } catch {
    return undefined;
  }
  const trimmed = text.trim();
  return {
    line,
    column,
    ...(key === undefined ? {} : { key }),
    occurrence: match[4] ? Number(match[4]) : 1,
    items: match[5] ? match[5].slice(1).split('/').map(Number) : [],
    markup: trimmed.length > maxMarkup ? `${trimmed.slice(0, maxMarkup - 1)}…` : trimmed
  };
}
