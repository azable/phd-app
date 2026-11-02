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
  smallest: v.number()
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

/** One line telling the assistant how large a version draws. */
export function readabilityText(readability: Readability): string {
  const { ratio, frame, content, parts, row, scale, text, smallest } = readability;
  const laid =
    parts.length > 1
      ? `, its ${parts.length} parts ${row ? 'side by side' : 'one above another'}, ${new Intl.ListFormat('en', { type: 'conjunction' }).format(parts.map(sized))}`
      : '';
  return `On a typical stage it shows at ${Math.round(scale * 100)}% of its written size, its content ${sized(content)}${laid}, in a ${ratio} frame of ${sized(frame)}: most of its text reads at about ${whole(text)} px, the smallest at ${whole(smallest)} px.`;
}

/** Why a picture cannot be shown as built, if its text would be too small to read. */
export function unreadableProblem(readability: Readability): string | undefined {
  if (readability.text >= smallestReadableText) return undefined;
  return `The picture is too large to read: ${readabilityText(readability)} Show less at once rather than keeping every part: remove or combine parts, or show one level or part at a time; where both are fair readings of the request, compare the whole at once against one part at a time.`;
}
