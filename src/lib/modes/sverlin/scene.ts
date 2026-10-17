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
const paletteColour = v.picklist(['neutral', 'blue', 'green', 'amber', 'red', 'purple']);
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
  shape: v.picklist(['box', 'card', 'plain']),
  layout: v.optional(v.picklist(['row', 'column', 'grid', 'free'])),
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
    radius: v.optional(length),
    padding: v.optional(v.tuple([length, length, length, length])),
    color: colour,
    font,
    fontSize: length,
    fontWeight,
    opacity: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)))
  }),
  palette: v.optional(
    v.strictObject({
      fill: v.optional(paletteColour),
      stroke: v.optional(paletteColour),
      color: v.optional(paletteColour)
    })
  )
});

const sceneLinkSchema = v.strictObject({
  id: v.optional(text),
  from: text,
  to: text,
  directed: v.boolean(),
  arrowSize: v.optional(length),
  dashed: v.optional(v.literal(true)),
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
  /** Design values drawn from the seed, if the presentation recorded them. */
  parameters?: Record<string, unknown>;
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
