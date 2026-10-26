/** Structured user-facing message content retained in project Timelines. */

import * as v from 'valibot';

import { presentationIdSchema } from '$lib/shared/presentations';
import { naturalSchema, textSchema } from './values';

export const markdownMessageSegmentSchema = v.strictObject({
  type: v.literal('markdown'),
  text: textSchema
});

/** A presentation, with the step the participant was on where they were viewing it, from 0. */
export const presentationReferenceSegmentSchema = v.strictObject({
  type: v.literal('presentation-ref'),
  presentationId: presentationIdSchema,
  step: v.optional(v.pipe(naturalSchema, v.maxValue(100_000)))
});

/**
 * A rendered element's id within one step of a presentation. Only Sverlin presentations support
 * selection; their ids are a node's tag position (line:column), then @ and its URL-encoded key if
 * it has one, then #n for its nth render, then /index for each item a collection drew itself, as in
 * 12:5#2/3 or 9:5@c. A <Link> has an id the same way.
 */
export const elementIdSchema = v.pipe(
  v.string(),
  v.maxLength(64),
  v.regex(/^\d{1,5}:\d{1,5}(?:@[\w.!~*'()%-]{1,24})?(?:#\d{1,5})?(?:\/\d{1,5}){0,8}$/u)
);

/** A short label for a selected element, taken from what it showed. */
export const elementLabelSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120));

const layoutFormSchema = v.picklist([
  'line',
  'snake',
  'wave',
  'arc',
  'scatter',
  'ring',
  'tree-down',
  'tree-right',
  'radial',
  'indented',
  'layers-down',
  'layers-right'
]);

/**
 * A constraint layout around a selected element: the node it belongs to (an element id, or 'frame'
 * for the page), the seed it drew from, and what it drew, so feedback can keep it by pinning the seed.
 */
export const elementLayoutSchema = v.pipe(
  v.strictObject({
    node: v.union([v.literal('frame'), elementIdSchema]),
    seed: v.pipe(v.number(), v.safeInteger()),
    form: v.optional(layoutFormSchema),
    /** The earlier name for form, read so references saved before the rename still load. */
    chain: v.optional(layoutFormSchema),
    curve: v.optional(v.picklist(['straight', 'curved']))
  }),
  v.transform(({ chain, ...layout }) =>
    chain === undefined || layout.form !== undefined ? layout : { ...layout, form: chain }
  )
);

/** A selected element: its id, a label from what it showed, and the layouts around it. */
export const selectedElementSchema = v.strictObject({
  id: elementIdSchema,
  label: elementLabelSchema,
  layouts: v.optional(v.pipe(v.array(elementLayoutSchema), v.maxLength(2))),
  /** For a link, the curve it drew: how far it bows to one side, as a fraction of its length. */
  bend: v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1)))
});

/**
 * What a Sverlin step on screen drew from its seed rather than its variant: its constraint
 * layouts.
 */
export const drawnStepSchema = v.object({
  layouts: v.pipe(v.array(elementLayoutSchema), v.maxLength(1000))
});

/** One element a participant selected in a presentation at a step, referenced in a message. */
export const elementReferenceSegmentSchema = v.strictObject({
  type: v.literal('element-ref'),
  presentationId: presentationIdSchema,
  step: v.pipe(naturalSchema, v.maxValue(100_000)),
  element: selectedElementSchema
});

/** Runtime schema for one Markdown or exact visualization reference segment. */
export const messageContentSegmentSchema = v.variant('type', [
  markdownMessageSegmentSchema,
  presentationReferenceSegmentSchema,
  elementReferenceSegmentSchema
]);

/** Runtime schema for a non-empty structured message. */
export const messageContentSchema = v.pipe(v.array(messageContentSegmentSchema), v.minLength(1));

export type MessageContentSegment = v.InferOutput<typeof messageContentSegmentSchema>;
export type MessageContent = MessageContentSegment[];
export type ElementLayout = v.InferOutput<typeof elementLayoutSchema>;
export type DrawnStep = v.InferOutput<typeof drawnStepSchema>;
export type ElementReference = Extract<MessageContentSegment, { type: 'element-ref' }>;

/** Construct the canonical representation of a text-only Markdown message. */
export function markdownMessage(text: string): MessageContent {
  const value = text.trim();
  if (!value) throw new Error('Message text cannot be empty.');
  return [{ type: 'markdown', text: value }];
}

/** Promote known presentation UUIDs in Markdown into interactive reference segments. */
export function structureKnownPresentationReferences(
  content: readonly MessageContentSegment[],
  presentationIds: readonly string[]
): MessageContent;
export function structureKnownPresentationReferences<Segment extends { type: string }>(
  content: readonly Segment[],
  presentationIds: readonly string[]
): Array<Exclude<Segment, { type: 'markdown' }> | MessageContentSegment>;
export function structureKnownPresentationReferences(
  content: readonly { type: string }[],
  presentationIds: readonly string[]
): Array<{ type: string }> {
  const known = new Map(presentationIds.map((id) => [id.toLowerCase(), id]));
  return content.flatMap((segment) => {
    if (segment.type !== 'markdown') return [segment];
    const text = (segment as { type: 'markdown'; text: string }).text;
    const structured: MessageContent = [];
    let cursor = 0;
    for (const match of text.matchAll(presentationReferencePattern)) {
      const presentationId = match[1] ? known.get(match[1].toLowerCase()) : undefined;
      if (!presentationId || match.index === undefined) continue;
      if (match.index > cursor) {
        structured.push({ type: 'markdown', text: text.slice(cursor, match.index) });
      }
      structured.push({ type: 'presentation-ref', presentationId });
      cursor = match.index + match[0].length;
    }
    if (cursor === 0) return [segment];
    if (cursor < text.length) {
      structured.push({ type: 'markdown', text: text.slice(cursor) });
    }
    return structured;
  });
}

/** Flatten structured content for compact logs and model-provider text channels. */
export function plainMessageText(content: MessageContent): string {
  return content
    .flatMap((segment) => {
      if (segment.type === 'markdown') return [segment.text];
      if (segment.type === 'element-ref')
        return [
          `[Element "${segment.element.label}" (${segment.element.id}) at step ${segment.step + 1} of presentation ${segment.presentationId}]`
        ];
      return [
        segment.step === undefined
          ? `[Presentation ${segment.presentationId}]`
          : `[Presentation ${segment.presentationId} at step ${segment.step + 1}]`
      ];
    })
    .join(' ')
    .trim();
}

const presentationReferencePattern =
  /`?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`?/giu;
