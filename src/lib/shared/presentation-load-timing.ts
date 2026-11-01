/**
 * How a presentation loaded in the browser: how long it took to appear, where its layout came from,
 * and the browser and fonts it was laid out in. Each report is written to the server's log and
 * recorded in the project Timeline as a visualization.loaded event, shown only in developer view,
 * so a project's exported data carries what is needed to debug a load from another system.
 */

import * as v from 'valibot';

import { presentationIdSchema } from './presentations';

// An hour bounds every duration; a page that takes longer is reported as stalled long before.
const milliseconds = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3_600_000));
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000));

/** One layout pass the page reported: its phase, step, duration, and layout changes so far. */
export const layoutPassSchema = v.strictObject({
  /** A layout phase, the first step showing (ready), or a wait for the page to be shown. */
  phase: v.picklist(['measuring', 'recording', 'showing', 'ready', 'shown']),
  step: v.optional(count),
  ms: milliseconds,
  changes: v.optional(count),
  waiting: v.optional(v.boolean()),
  /** For a wait to be shown: whether the page was hidden or had no size yet. */
  waitedFor: v.optional(v.picklist(['size', 'visibility'])),
  /** For recording: whether every step's layout came from the server or was worked out in the page. */
  layout: v.optional(v.picklist(['server', 'page']))
});

const pixels = v.pipe(v.number(), v.integer(), v.minValue(-100_000), v.maxValue(100_000));
const frameBoxSchema = v.strictObject({ width: pixels, height: pixels, top: pixels, left: pixels });

/** How wide the page set a sample text in each embedded font, to compare with the server's measure. */
export const fontWidthsSchema = v.strictObject({
  /** The embedded fonts' version, as the sandbox document names it. */
  version: v.optional(v.pipe(v.string(), v.maxLength(100))),
  /** Whether every embedded font loaded; if not, the widths are of the fonts the page fell back to. */
  loaded: v.boolean(),
  sample: v.pipe(v.string(), v.maxLength(100)),
  /** Each width in pixels, keyed by "family weight size", as "Inter 400 16". */
  widths: v.pipe(
    v.record(v.pipe(v.string(), v.maxLength(100)), v.pipe(v.number(), v.minValue(0))),
    v.maxEntries(64)
  )
});

export const presentationLoadTimingSchema = v.strictObject({
  presentationId: presentationIdSchema,
  /** Ready once the first step showed; stalled when it had not after the viewer's patience ran out. */
  outcome: v.picklist(['ready', 'stalled']),
  /** From the viewer starting to load the page until the outcome. */
  sinceLoadMs: milliseconds,
  /** From the page's script starting until its first step showed, as the page measured it. */
  pageMs: v.optional(milliseconds),
  /** When the page said it had loaded, from the viewer starting to load it. */
  loadedMs: v.optional(milliseconds),
  /** Where every step's layout came from: the server, or the page itself. */
  layout: v.optional(v.picklist(['server', 'page'])),
  measuringMs: milliseconds,
  recordingMs: milliseconds,
  showingMs: milliseconds,
  passes: count,
  /** The most layout changes any one pass went through before settling. */
  mostChanges: count,
  /** How long the page waited to be shown before laying out, and whether for visibility or size. */
  shownWait: v.optional(
    v.strictObject({ ms: milliseconds, waitedFor: v.picklist(['size', 'visibility']) })
  ),
  visibility: v.picklist(['visible', 'hidden']),
  /** The frame's size and place in the window when the page loaded and at the outcome. */
  frameAtLoad: v.optional(frameBoxSchema),
  frameAtOutcome: v.optional(frameBoxSchema),
  /** The last pass the page reported, which for a stalled load is where it waits. */
  last: v.optional(layoutPassSchema),
  /** The page's device pixel ratio, which geometry from the server must match. */
  devicePixelRatio: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))),
  userAgent: v.optional(v.pipe(v.string(), v.maxLength(1_000))),
  /** Measured as soon as the fonts loaded, before laying out; absent if the page never got there. */
  fonts: v.optional(fontWidthsSchema)
});

export type PresentationLoadTiming = v.InferOutput<typeof presentationLoadTimingSchema>;
export type FontWidths = v.InferOutput<typeof fontWidthsSchema>;
