/** Structured user-facing message content retained in project Timelines. */

import * as v from 'valibot';

import { interfacePart, interfacePartIds } from '$lib/shared/interface-parts';
import { presentationIdSchema, stepNameSchema } from '$lib/shared/presentations';
import { naturalSchema, textSchema } from './values';

export const markdownMessageSegmentSchema = v.strictObject({
  type: v.literal('markdown'),
  text: textSchema
});

/**
 * A presentation, with the step the participant was on where they were viewing it, from 0, and its
 * name where it has one (see stepNameSchema).
 */
export const presentationReferenceSegmentSchema = v.strictObject({
  type: v.literal('presentation-ref'),
  presentationId: presentationIdSchema,
  step: v.optional(v.pipe(naturalSchema, v.maxValue(100_000))),
  stepName: v.optional(stepNameSchema)
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

const layoutFormSchema = v.picklist(['natural', 'line', 'snake', 'wave', 'arc', 'scatter']);

/**
 * A free layout around a selected element: the node it belongs to, by its element id, the kind
 * whose variables hold its look, that kind's layout seed, and the form, direction and curve it
 * drew, so feedback can keep it by setting those variables.
 */
export const elementLayoutSchema = v.strictObject({
  node: elementIdSchema,
  kind: v.optional(v.pipe(v.string(), v.maxLength(200))),
  seed: v.pipe(v.number(), v.safeInteger()),
  form: v.optional(layoutFormSchema),
  direction: v.optional(v.picklist(['down', 'right'])),
  curve: v.optional(v.picklist(['straight', 'curved']))
});

/**
 * A selected element: its id, a label from what it showed, the layouts around it, and the place of
 * the token clicked in it, as `:i` or `:@scan.check` for a listing's `:i[…]`.
 */
export const selectedElementSchema = v.strictObject({
  id: elementIdSchema,
  label: elementLabelSchema,
  place: v.optional(
    v.pipe(v.string(), v.regex(/^:@?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/u), v.maxLength(200))
  ),
  layouts: v.optional(v.pipe(v.array(elementLayoutSchema), v.maxLength(2)))
});

/** One element a participant selected in a presentation at a step, referenced in a message. */
export const elementReferenceSegmentSchema = v.strictObject({
  type: v.literal('element-ref'),
  presentationId: presentationIdSchema,
  step: v.pipe(naturalSchema, v.maxValue(100_000)),
  stepName: v.optional(stepNameSchema),
  element: selectedElementSchema
});

/** A point in a presentation's frame, in its own coordinates, as a scene's boxes are. */
export const framePointSchema = v.strictObject({
  x: v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000)),
  y: v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000))
});

/** The most an annotation says: a short note on one part, as a sentence or two. */
export const annotationTextMaxLength = 280;

/**
 * A short comment a participant pinned in a presentation at a step, sent with a message or a
 * comparison's answer: on the element selected where it was pinned, at the point clicked, or both,
 * so it is feedback on that one design, drawn there as a numbered pin when it is viewed again.
 */
export const annotationSegmentSchema = v.strictObject({
  type: v.literal('annotation'),
  presentationId: presentationIdSchema,
  step: v.pipe(naturalSchema, v.maxValue(100_000)),
  stepName: v.optional(stepNameSchema),
  element: v.optional(selectedElementSchema),
  point: v.optional(framePointSchema),
  text: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(annotationTextMaxLength))
});

/**
 * A part of the workspace an assistant's reply points at (shared/interface-parts.ts), shown as a
 * pill with the part's name that highlights it.
 */
export const interfaceReferenceSegmentSchema = v.strictObject({
  type: v.literal('interface-ref'),
  part: v.picklist(interfacePartIds)
});

/**
 * Runtime schema for one Markdown or exact visualization reference segment, or, in the assistant's
 * replies only (see validateMessageContent in commands.ts), an interface part.
 */
export const messageContentSegmentSchema = v.variant('type', [
  markdownMessageSegmentSchema,
  presentationReferenceSegmentSchema,
  elementReferenceSegmentSchema,
  annotationSegmentSchema,
  interfaceReferenceSegmentSchema
]);

/** Runtime schema for a non-empty structured message. */
export const messageContentSchema = v.pipe(v.array(messageContentSegmentSchema), v.minLength(1));

export type MessageContentSegment = v.InferOutput<typeof messageContentSegmentSchema>;
export type MessageContent = MessageContentSegment[];
export type ElementLayout = v.InferOutput<typeof elementLayoutSchema>;
export type ElementReference = Extract<MessageContentSegment, { type: 'element-ref' }>;
export type Annotation = Extract<MessageContentSegment, { type: 'annotation' }>;
export type FramePoint = v.InferOutput<typeof framePointSchema>;

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
      if (segment.type === 'interface-ref')
        return [`[Interface part ${segment.part}: ${interfacePart(segment.part).name}]`];
      if (segment.type === 'annotation') return [annotationText(segment)];
      if (segment.type === 'element-ref')
        return [
          `[Element "${segment.element.label}" (${segment.element.id}) at ${stepText(segment.step, segment.stepName)} of presentation ${segment.presentationId}]`
        ];
      return [
        segment.step === undefined
          ? `[Presentation ${segment.presentationId}]`
          : `[Presentation ${segment.presentationId} at ${stepText(segment.step, segment.stepName)}]`
      ];
    })
    .join(' ')
    .trim();
}

/** An annotation as a model reads it: where it is pinned, then what it says. */
function annotationText({ presentationId, step, stepName, element, point, text }: Annotation) {
  const on = [
    element ? `element "${element.label}" (${element.id})` : undefined,
    point ? `point (${Math.round(point.x)}, ${Math.round(point.y)}) of the frame` : undefined
  ]
    .filter(Boolean)
    .join(' at ');
  return `[Comment pinned to ${on || 'the picture'} at ${stepText(step, stepName)} of presentation ${presentationId}: "${text}"]`;
}

/** A step as a message names it: by its name, with the number the participant saw. */
const stepText = (step: number, name: string | undefined) =>
  name ? `${name} (step ${step + 1})` : `step ${step + 1}`;

const presentationReferencePattern =
  /`?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`?/giu;
