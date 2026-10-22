/**
 * The scene data a Sverlin presentation's page sends when asked (see library/scene.ts), checked
 * here because the page runs authored code, and the exported scene that render targets read.
 */

import * as v from 'valibot';

import type { SceneFrame, SceneStep } from './library';

// A view draws at most a few nodes per value the algorithm keeps, and a trace holds at most 200,000
// values over at most 200 steps (algorithmLimits in algorithm/interpret.server.ts); these bounds sit
// well above any real view while keeping one export to tens of megabytes.
const maximumSteps = 200;
const maximumNodes = 20_000;
const maximumText = 10_000;

const text = v.pipe(v.string(), v.maxLength(maximumText));
const colour = v.pipe(v.string(), v.maxLength(200));
const coordinate = v.pipe(v.number(), v.minValue(-1_000_000), v.maxValue(1_000_000));
const length = v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000));
const point = v.strictObject({ x: coordinate, y: coordinate });
const colourName = v.pipe(v.string(), v.maxLength(40));
const strokeStyle = v.picklist(['dashed', 'dotted']);
const box = v.strictObject({ x: coordinate, y: coordinate, width: length, height: length });
const font = v.pipe(v.string(), v.maxLength(500));
const fontWeight = v.pipe(v.number(), v.minValue(1), v.maxValue(1000));

const sceneTextSchema = v.strictObject({
  text,
  box,
  color: colour,
  font,
  fontSize: length,
  fontWeight
});

const sceneNodeSchema = v.strictObject({
  id: text,
  parent: v.optional(text),
  key: v.optional(text),
  type: v.optional(text),
  kind: v.optional(text),
  layout: v.optional(v.picklist(['row', 'column', 'free'])),
  collection: v.optional(v.literal(true)),
  value: v.optional(text),
  unit: v.optional(text),
  text: v.optional(text),
  runs: v.optional(v.pipe(v.array(sceneTextSchema), v.maxLength(maximumNodes))),
  box,
  look: v.strictObject({
    fill: v.optional(colour),
    stroke: v.optional(colour),
    strokeWidth: v.optional(length),
    strokeStyle: v.optional(strokeStyle),
    radius: v.optional(length),
    padding: v.optional(v.tuple([length, length, length, length])),
    color: colour,
    font,
    fontSize: length,
    fontWeight,
    opacity: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)))
  }),
  colours: v.optional(
    v.strictObject({
      fill: v.optional(colourName),
      stroke: v.optional(colourName),
      color: v.optional(colourName)
    })
  )
});

const sceneLinkSchema = v.strictObject({
  id: v.optional(text),
  from: text,
  to: text,
  directed: v.boolean(),
  arrowSize: v.optional(length),
  strokeStyle: v.optional(strokeStyle),
  stroke: colour,
  strokeWidth: length,
  curve: v.tuple([point, point, point, point]),
  label: v.optional(v.strictObject({ text, at: point, color: colour, font, fontSize: length }))
});

const sceneStepSchema = v.strictObject({
  nodes: v.pipe(v.array(sceneNodeSchema), v.maxLength(maximumNodes)),
  links: v.pipe(v.array(sceneLinkSchema), v.maxLength(maximumNodes)),
  error: v.optional(text)
});

const sceneFrameSchema = v.strictObject({ width: length, height: length, background: colour });

/** The page's answer to a request for its scene: every step, or why it could not describe them. */
export const sceneMessageSchema = v.union([
  v.strictObject({
    type: v.literal('sverlin:scene'),
    request: text,
    frame: sceneFrameSchema,
    steps: v.pipe(v.array(sceneStepSchema), v.minLength(1), v.maxLength(maximumSteps))
  }),
  v.strictObject({ type: v.literal('sverlin:scene'), request: text, failure: text })
]);

/** One presentation's scene, with what identifies it, as render targets read it. */
export type SverlinScene = {
  format: 'sverlin-scene-v1';
  presentationId: string;
  seed: number;
  /** The presentation's variant, if it recorded one. */
  variant?: Record<string, string | number | boolean>;
  frame: SceneFrame;
  steps: (SceneStep & { label: string })[];
};

// The page describes steps with the library's types, and this schema checks them; they must agree.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const agree: [
  Same<v.InferOutput<typeof sceneStepSchema>, SceneStep>,
  Same<v.InferOutput<typeof sceneFrameSchema>, SceneFrame>
] = [true, true];
void agree;
