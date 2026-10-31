/**
 * How long a presentation took to appear in the browser, reported to the server's log so load
 * times can be audited. It never enters the project Timeline, so reporting cannot conflict with
 * the participant's own commands.
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
  last: v.optional(layoutPassSchema)
});

export type PresentationLoadTiming = v.InferOutput<typeof presentationLoadTimingSchema>;
