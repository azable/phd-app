/**
 * How large a presentation draws on a typical stage, as a mode lays it out on the server (see
 * modes/sverlin/readability.server.ts): told to the assistant with each version, and sent back
 * once where its text would be too small to read.
 */

import * as v from 'valibot';

const sizeSchema = v.strictObject({ width: v.number(), height: v.number() });

export const readabilitySchema = v.strictObject({
  /** The frame's shape, as 16:9, or fit for one taking its content's shape. */
  ratio: v.pipe(v.string(), v.maxLength(20)),
  /** The frame as drawn and the content in it as written, in CSS pixels, before scaling. */
  frame: sizeSchema,
  content: sizeSchema,
  /** The root's parts, as written, side by side in a row or one above another. */
  parts: v.array(sizeSchema),
  row: v.boolean(),
  /** How large the content shows on the typical stage, as a share of its written size. */
  scale: v.number(),
  /** On-screen pixels of the text half the text is at or under, and of the smallest text. */
  text: v.number(),
  smallest: v.number(),
  /** The share of the frame's area the content's box covers as drawn; absent in older builds. */
  fill: v.optional(v.number())
});

export type Readability = v.InferOutput<typeof readabilitySchema>;

/**
 * The on-screen text size below which most text is too small to read. Interface type scales stop
 * at 11 px (Material Design 3's label small, Apple's caption 2), but in pilot 2 a version whose
 * text drew at about 9 px on the typical stage was read without complaint, and the versions
 * that could not be read drew at 2–3 px, so the line is drawn under the one that was read.
 */
export const smallestReadableText = 8;

const whole = (value: number) => Math.round(value).toLocaleString('en');
const sized = ({ width, height }: { width: number; height: number }) =>
  `${whole(width)}×${whole(height)} px`;

// A content half again as wide as it is tall, or as tall as wide, reads as wide or tall.
const elongated = 1.5;

/**
 * The layout's shape at a glance, to compare versions by: its content's aspect ratio, how much of
 * its frame it fills, and its parts, as "2.4:1 wide, filling 38% of its frame, 2 parts side by
 * side".
 */
export function layoutShape({ content, parts, row, fill }: Readability): string {
  const aspect = content.width / content.height;
  const tenths = (value: number) => Math.round(value * 10) / 10;
  const ratio = aspect >= 1 ? `${tenths(aspect)}:1` : `1:${tenths(1 / aspect)}`;
  const shape = aspect >= elongated ? 'wide' : aspect <= 1 / elongated ? 'tall' : 'near square';
  const filled = fill === undefined ? '' : `, filling ${Math.round(fill * 100)}% of its frame`;
  const laid =
    parts.length > 1
      ? `${parts.length} parts ${row ? 'side by side' : 'one above another'}`
      : '1 part';
  return `${ratio} ${shape}${filled}, ${laid}`;
}

/** One line telling the assistant how a version is laid out and how large it draws. */
export function readabilityText(readability: Readability): string {
  const { ratio, frame, content, parts, scale, text, smallest } = readability;
  const sizes =
    parts.length > 1
      ? `, its parts ${new Intl.ListFormat('en', { type: 'conjunction' }).format(parts.map(sized))}`
      : '';
  return `Layout ${layoutShape(readability)}. On a typical stage it shows at ${Math.round(scale * 100)}% of its written size, its content ${sized(content)}${sizes}, in a ${ratio} frame of ${sized(frame)}: most of its text reads at about ${whole(text)} px, the smallest at ${whole(smallest)} px.`;
}

/** Why a picture cannot be shown as built, if its text would be too small to read. */
export function unreadableProblem(readability: Readability): string | undefined {
  if (readability.text >= smallestReadableText) return undefined;
  return `The picture is too large to read: ${readabilityText(readability)} Show less at once rather than keeping every part: remove or combine parts, or show one level or part at a time; where both are fair readings of the request, compare the whole at once against one part at a time.`;
}

/**
 * Another arrangement of a version's free layouts, laid out by the server with no model call (see
 * modes/sverlin/arrangements.server.ts): the values it sets, how large it draws, and how many pairs
 * of its links cross.
 */
export const arrangementSchema = v.strictObject({
  values: v.record(
    v.pipe(v.string(), v.maxLength(200)),
    v.union([v.string(), v.number(), v.boolean()])
  ),
  readability: readabilitySchema,
  crossings: v.number(),
  /** Whether it is the version's own arrangement. */
  shown: v.optional(v.boolean())
});

export type Arrangement = v.InferOutput<typeof arrangementSchema>;

/**
 * Arrangements best first: text readable on the typical stage before anything, then a fuller frame
 * with fewer crossings, each crossing costing a tenth of the frame; the shown one first of equals.
 */
export function rankedArrangements(arrangements: readonly Arrangement[]): Arrangement[] {
  const score = ({ readability, crossings }: Arrangement) =>
    (readability.text >= smallestReadableText ? 1 : 0) + (readability.fill ?? 0) - crossings / 10;
  return arrangements.toSorted(
    (a, b) => score(b) - score(a) || Number(b.shown ?? false) - Number(a.shown ?? false)
  );
}

/** How many arrangements the assistant is told of, best first. */
const toldArrangements = 5;

/**
 * The best arrangements in a line each, for the assistant: the values each sets, its shape, its
 * crossings and its text size, as "Graph.layoutSeed 3: 1.2:1 near square, filling 74% of its
 * frame, 1 part, 0 crossings, text 14 px". One measuring as one above it does is left out, as
 * nothing here tells them apart.
 */
export function arrangementsText(arrangements: readonly Arrangement[]): string[] {
  const told = new Set<string>();
  return rankedArrangements(arrangements)
    .flatMap(({ values, readability, crossings, shown }) => {
      const facts = `${layoutShape(readability)}, ${crossings} crossing${crossings === 1 ? '' : 's'}, text ${whole(readability.text)} px`;
      if (told.has(facts)) return [];
      told.add(facts);
      const set = Object.entries(values)
        .map(([variable, value]) => `${variable} ${value}`)
        .join(', ');
      return [`${set}: ${facts}${shown ? ' (shown)' : ''}`];
    })
    .slice(0, toldArrangements);
}
