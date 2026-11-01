/** Versioned participant-workspace observation and ingestion contracts. */

import * as v from 'valibot';

import {
  elementIdSchema,
  messageContentSegmentSchema
} from '$lib/shared/projects/events/message-content';
import { naturalSchema, positiveSchema } from '$lib/shared/projects/events/values';
import { presentationIdSchema } from '$lib/shared/presentations';

const boundedText = (maximum: number) => v.pipe(v.string(), v.maxLength(maximum));
const boundedNatural = (maximum: number) => v.pipe(naturalSchema, v.maxValue(maximum));
const normalizedCoordinateSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const finiteCoordinateSchema = v.pipe(v.number(), v.minValue(-1_000_000), v.maxValue(1_000_000));

/** Reproducible collection settings embedded in an exact study definition. */
export const studyInteractionCapturePolicySchema = v.strictObject({
  schemaVersion: v.literal(1),
  cursorSampleIntervalMs: positiveSchema,
  cursorChunkDurationMs: positiveSchema,
  flushIntervalMs: positiveSchema,
  flushRecordThreshold: positiveSchema,
  flushByteThreshold: positiveSchema,
  checkpointIntervalMs: positiveSchema,
  draftSnapshotIntervalMs: positiveSchema,
  outboxByteLimit: positiveSchema,
  lateDeliverySeconds: positiveSchema
});

const viewportSizeSchema = v.strictObject({
  width: boundedNatural(20_000),
  height: boundedNatural(20_000),
  devicePixelRatio: v.pipe(v.number(), v.minValue(0.1), v.maxValue(20))
});

/** Metadata supplied once for one browser tab's task-workspace recording. */
export const studyInteractionSessionInputSchema = v.strictObject({
  id: v.pipe(v.string(), v.uuid()),
  projectId: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
  schemaVersion: v.literal(1),
  clientStartedAt: v.pipe(v.string(), v.isoTimestamp()),
  timeOrigin: v.pipe(v.number(), v.minValue(0)),
  initialViewport: viewportSizeSchema,
  applicationVersion: boundedText(64),
  buildSha: v.optional(boundedText(128)),
  capture: studyInteractionCapturePolicySchema
});

const playbackStateSchema = v.strictObject({
  contextKey: boundedText(512),
  step: naturalSchema,
  frameKey: v.optional(boundedText(512)),
  localSteps: v.pipe(
    v.array(
      v.strictObject({
        presentationId: presentationIdSchema,
        step: v.pipe(v.number(), v.safeInteger(), v.minValue(-1))
      })
    ),
    v.maxLength(2)
  )
});

const timelineViewportSchema = v.strictObject({
  following: v.boolean(),
  scrollTop: boundedNatural(10_000_000),
  scrollHeight: boundedNatural(10_000_000),
  clientHeight: boundedNatural(100_000),
  normalized: normalizedCoordinateSchema
});

const visualizationViewportSchema = v.strictObject({
  presentationId: presentationIdSchema,
  zoom: v.pipe(v.number(), v.minValue(0.1), v.maxValue(10)),
  panX: finiteCoordinateSchema,
  panY: finiteCoordinateSchema
});

/** Complete allowlisted browser state used for coarse replay and recovery. */
export const studyWorkspaceObservationSchema = v.strictObject({
  projectHead: naturalSchema,
  viewedProjectEvent: v.optional(naturalSchema),
  activeOperation: v.optional(
    v.strictObject({
      id: v.pipe(v.string(), v.uuid()),
      kind: boundedText(64),
      status: v.picklist(['accepted', 'running'])
    })
  ),
  connection: v.picklist(['connecting', 'open', 'reconnecting']),
  atHead: v.boolean(),
  layout: v.picklist(['single', 'comparison']),
  visiblePresentationIds: v.pipe(v.array(presentationIdSchema), v.maxLength(2)),
  followingLatestPresentations: v.boolean(),
  focusedTimelineEvents: v.pipe(v.array(positiveSchema), v.maxLength(100)),
  playback: v.optional(playbackStateSchema),
  timeline: v.optional(timelineViewportSchema),
  viewports: v.pipe(v.array(visualizationViewportSchema), v.maxLength(2)),
  /** Elements selected in the visible presentations, by id. */
  selections: v.optional(
    v.pipe(
      v.array(
        v.strictObject({
          presentationId: presentationIdSchema,
          step: naturalSchema,
          elements: v.pipe(v.array(elementIdSchema), v.minLength(1), v.maxLength(50))
        })
      ),
      v.maxLength(2)
    )
  ),
  /** The introduction or hint step on screen, by tour id ("sverlin:intro") and step index. */
  tour: v.optional(
    v.strictObject({ id: boundedText(64), step: naturalSchema, count: positiveSchema })
  ),
  draft: v.strictObject({
    hasContent: v.boolean(),
    characterCount: boundedNatural(100_000),
    referenceCount: boundedNatural(1_000),
    focused: v.boolean()
  }),
  document: v.strictObject({
    visibility: v.picklist(['visible', 'hidden']),
    focused: v.boolean(),
    viewport: viewportSizeSchema
  })
});

const interactionEnvelope = {
  sequence: positiveSchema,
  elapsedMs: naturalSchema,
  clientOccurredAt: v.pipe(v.string(), v.isoTimestamp()),
  projectHead: naturalSchema
};

const pointerPointSchema = v.strictObject({
  offsetMs: naturalSchema,
  clientX: finiteCoordinateSchema,
  clientY: finiteCoordinateSchema,
  normalizedX: normalizedCoordinateSchema,
  normalizedY: normalizedCoordinateSchema,
  region: v.optional(boundedText(128))
});

const normalizedBoundsSchema = v.strictObject({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
  width: normalizedCoordinateSchema,
  height: normalizedCoordinateSchema
});

/** One ordered, client-observed interaction record. */
export const studyInteractionEventInputSchema = v.variant('kind', [
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('workspace.state'),
    payload: v.strictObject({
      reason: v.picklist(['changed', 'checkpoint', 'started', 'resumed']),
      state: studyWorkspaceObservationSchema
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('ui.activated'),
    payload: v.strictObject({
      input: v.picklist(['pointer', 'keyboard']),
      action: boundedText(128),
      region: v.optional(boundedText(128)),
      clientX: v.optional(finiteCoordinateSchema),
      clientY: v.optional(finiteCoordinateSchema),
      normalizedX: v.optional(normalizedCoordinateSchema),
      normalizedY: v.optional(normalizedCoordinateSchema),
      button: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(5))),
      shiftKey: v.boolean(),
      altKey: v.boolean(),
      ctrlKey: v.boolean(),
      metaKey: v.boolean()
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('ui.region'),
    payload: v.strictObject({
      state: v.picklist(['entered', 'left', 'focused']),
      region: boundedText(128),
      presentationId: v.optional(presentationIdSchema),
      bounds: normalizedBoundsSchema
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('pointer.path'),
    payload: v.strictObject({
      pointerType: v.picklist(['mouse', 'pen', 'touch', 'unknown']),
      points: v.pipe(v.array(pointerPointSchema), v.minLength(1), v.maxLength(32))
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('draft.snapshot'),
    payload: v.strictObject({
      content: v.pipe(v.array(messageContentSegmentSchema), v.maxLength(200)),
      focused: v.boolean(),
      truncated: v.boolean(),
      originalByteLength: naturalSchema
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('document.lifecycle'),
    payload: v.strictObject({
      state: v.picklist(['visible', 'hidden', 'focused', 'blurred', 'online', 'offline', 'stopped'])
    })
  }),
  v.strictObject({
    ...interactionEnvelope,
    kind: v.literal('recorder.dropped'),
    payload: v.strictObject({
      counts: v.record(v.string(), naturalSchema),
      reason: v.picklist([
        'outbox-limit',
        'storage-unavailable',
        'invalid-record',
        'transport-limit'
      ])
    })
  })
]);

/** Immutable terminal extent of one browser recording session. */
export const studyInteractionTerminalSchema = v.strictObject({
  clientStoppedAt: v.pipe(v.string(), v.isoTimestamp()),
  recordedThrough: naturalSchema
});

/** Idempotent batch accepted by the participant interaction endpoint. */
export const studyInteractionBatchInputSchema = v.pipe(
  v.strictObject({
    session: studyInteractionSessionInputSchema,
    terminal: v.optional(studyInteractionTerminalSchema),
    events: v.pipe(v.array(studyInteractionEventInputSchema), v.maxLength(100))
  }),
  v.check(
    ({ events, terminal }) => events.length > 0 || terminal !== undefined,
    'An interaction batch must contain events or terminal metadata.'
  )
);

export type StudyInteractionCapturePolicy = v.InferOutput<
  typeof studyInteractionCapturePolicySchema
>;
export type StudyInteractionSessionInput = v.InferOutput<typeof studyInteractionSessionInputSchema>;
export type StudyWorkspaceObservation = v.InferOutput<typeof studyWorkspaceObservationSchema>;
export type StudyInteractionEventInput = v.InferOutput<typeof studyInteractionEventInputSchema>;
export type StudyInteractionTerminal = v.InferOutput<typeof studyInteractionTerminalSchema>;
export type StudyInteractionBatchInput = v.InferOutput<typeof studyInteractionBatchInputSchema>;
export type StudyInteractionKind = StudyInteractionEventInput['kind'];
export type StudyInteractionIngestionResult = {
  acceptedThrough: number;
  serverReceivedAt: string;
  terminalAccepted: boolean;
  deliveryComplete: boolean;
};
export type StudyInteractionErrorCode =
  | 'body-too-large'
  | 'capture-policy-mismatch'
  | 'capture-unavailable'
  | 'delivery-window-closed'
  | 'future-project-head'
  | 'invalid-batch'
  | 'invalid-event'
  | 'invalid-json'
  | 'invalid-session'
  | 'project-mismatch'
  | 'rate-limited'
  | 'sequence-conflict'
  | 'session-outside-phase'
  | 'temporarily-unavailable'
  | 'terminal-conflict';
export type StudyInteractionErrorResponse = {
  error: string;
  code: StudyInteractionErrorCode;
  acceptedThrough?: number;
  requiredNext?: number;
  invalidEventIndex?: number;
};

/** Validate a browser ingestion payload and reject unknown keys. */
export function parseStudyInteractionBatch(value: unknown): StudyInteractionBatchInput {
  return v.parse(studyInteractionBatchInputSchema, value);
}
