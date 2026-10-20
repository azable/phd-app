/** Mode-neutral presentation, layout, and HTML-frame contracts. */

import * as v from 'valibot';
import { modeCatalog } from '$lib/modes/catalog';

import {
  naturalSchema,
  positiveSchema,
  recordedTextSchema,
  textSchema
} from './projects/events/values';

/** Modes available to projects and study conditions. */
export const visualizationModeSchema = v.picklist(
  Object.keys(modeCatalog) as [keyof typeof modeCatalog, ...(keyof typeof modeCatalog)[]]
);

const scriptedModeSchema = v.picklist(
  Object.entries(modeCatalog)
    .filter(([, mode]) => mode.scriptedPlayback)
    .map(([id]) => id) as [keyof typeof modeCatalog, ...(keyof typeof modeCatalog)[]]
);

/** Number of simultaneously displayed presentations. */
export const presentationLayoutSchema = v.picklist(['single', 'comparison']);

/** Server-authorized projection used to build a workspace response. */
export const workspaceViewSchema = v.picklist(['participant', 'developer']);

/** One complete static HTML checkpoint. */
export const htmlFrameSchema = v.strictObject({
  label: textSchema,
  html: textSchema
});

/** Editable source contract for a steppable, script-free HTML presentation. */
export const htmlFramesManifestSchema = v.strictObject({
  format: v.literal('sverlin-html-frames'),
  version: v.literal(1),
  frames: v.pipe(v.array(htmlFrameSchema), v.minLength(1))
});

/** Stable identity for a presentation, independent of its Timeline event position. */
export const presentationIdSchema = v.pipe(v.string(), v.uuid());

const presentationEnvelope = { presentationId: presentationIdSchema };

/** AI- or user-authored static HTML checkpoints plus the exact safe render bundle. */
export const htmlFramesPresentationSchema = v.strictObject({
  ...presentationEnvelope,
  format: v.literal('html-frames-v1'),
  stepSignature: textSchema,
  authored: recordedTextSchema,
  rendered: recordedTextSchema,
  generationEventId: v.optional(positiveSchema)
});

/** One draw a presentation's seed made in its source's design block. */
export const designDrawSchema = v.strictObject({
  /** The draw's place in the block, such as look.radius; with the seed, it alone decides the value. */
  key: v.string(),
  call: v.picklist(['pick', 'int', 'real', 'chance']),
  /** The evaluated arguments: pick's choices, int's or real's bounds, or chance's probability. */
  args: v.array(v.unknown()),
  value: v.unknown(),
  /** The call's span in the presentation's source. */
  start: naturalSchema,
  end: naturalSchema
});

/** Self-contained JavaScript bundle executed only inside an isolated presentation iframe. */
export const browserBundlePresentationSchema = v.strictObject({
  ...presentationEnvelope,
  format: v.literal('browser-bundle-v1'),
  mode: scriptedModeSchema,
  stepSignature: textSchema,
  labels: v.pipe(v.array(textSchema), v.minLength(1)),
  seed: positiveSchema,
  source: recordedTextSchema,
  html: recordedTextSchema,
  javascript: recordedTextSchema,
  /** Master trace index of each label, ascending; absent when steps are not aligned. */
  masterSteps: v.optional(
    v.pipe(
      v.array(naturalSchema),
      v.check(
        (steps) => steps.every((step, index) => index === 0 || step > steps[index - 1]),
        'Master steps must be strictly increasing.'
      )
    )
  ),
  /** Design values drawn from the seed for this presentation. */
  parameters: v.optional(v.record(v.string(), v.unknown())),
  /** Each draw behind the design values; absent for presentations built before draws were kept. */
  draws: v.optional(v.array(designDrawSchema)),
  generationEventId: v.optional(positiveSchema)
});

/** Any steppable presentation accepted by the workspace. */
export const renderablePresentationSchema = v.variant('format', [
  htmlFramesPresentationSchema,
  browserBundlePresentationSchema
]);

export type VisualizationMode = v.InferOutput<typeof visualizationModeSchema>;
export type DesignDraw = v.InferOutput<typeof designDrawSchema>;
export type PresentationLayout = v.InferOutput<typeof presentationLayoutSchema>;
export type WorkspaceView = v.InferOutput<typeof workspaceViewSchema>;
export type HtmlFrame = v.InferOutput<typeof htmlFrameSchema>;
export type HtmlFramesManifest = v.InferOutput<typeof htmlFramesManifestSchema>;
export type HtmlFramesPresentation = v.InferOutput<typeof htmlFramesPresentationSchema>;
export type BrowserBundlePresentation = v.InferOutput<typeof browserBundlePresentationSchema>;
export type RenderablePresentation = v.InferOutput<typeof renderablePresentationSchema>;

/** Resolve the mode that owns validation and playback of a retained presentation. */
export function presentationMode(presentation: RenderablePresentation): VisualizationMode {
  return presentation.format === 'html-frames-v1' ? 'html' : presentation.mode;
}

/** Return the labels used by the mode-neutral playback controls. */
export function presentationStepLabels(presentation: RenderablePresentation): string[] {
  if (presentation.format === 'browser-bundle-v1') return presentation.labels;
  const parsed = v.parse(htmlFramesManifestSchema, JSON.parse(presentation.rendered.text));
  return parsed.frames.map(({ label }) => label);
}

/** One shared playback position across simultaneously displayed presentations. */
export type AlignedFrame = {
  label: string;
  /** Local step each presentation shows at this position, by presentation ID. */
  localSteps: Record<string, number>;
  /** Presentations that omit this step and keep showing their previous one. */
  held: string[];
};

/**
 * Align presentations for playback. Presentations of one master trace (same step signature,
 * each keeping a subset of master steps) align by master step, holding their previous step
 * where they omit one. Others align by position, up to the shortest.
 */
export function alignPresentationFrames(
  presentations: readonly RenderablePresentation[]
): AlignedFrame[] {
  const labels = presentations.map(presentationStepLabels);
  const masters = presentations.map((presentation, index) =>
    presentation.format === 'browser-bundle-v1' &&
    presentation.masterSteps?.length === labels[index].length &&
    presentation.stepSignature === presentations[0].stepSignature
      ? presentation.masterSteps
      : undefined
  );
  if (presentations.length > 1 && masters.every((steps) => steps !== undefined)) {
    const union = [...new Set(masters.flat())].toSorted((left, right) => left - right);
    return union.map((master) => {
      const localSteps: Record<string, number> = {};
      const held: string[] = [];
      let label = '';
      presentations.forEach(({ presentationId }, index) => {
        const steps = masters[index] as number[];
        const local = Math.max(
          steps.findLastIndex((step) => step <= master),
          0
        );
        localSteps[presentationId] = local;
        if (steps[local] === master) label ||= labels[index][local];
        else held.push(presentationId);
      });
      return { label, localSteps, held };
    });
  }
  const stepCount = Math.min(...labels.map((steps) => steps.length));
  return Array.from({ length: Number.isFinite(stepCount) ? stepCount : 0 }, (_, step) => ({
    label: labels[0][step] ?? `Step ${step + 1}`,
    localSteps: Object.fromEntries(
      presentations.map(({ presentationId }) => [presentationId, step])
    ),
    held: []
  }));
}

/** Whether this mode supports seeded side-by-side comparison. */
export function isSverlinPresentation(
  presentation: RenderablePresentation
): presentation is BrowserBundlePresentation & { mode: 'sverlin' } {
  return presentation.format === 'browser-bundle-v1' && presentation.mode === 'sverlin';
}

/** Compatibility identity for synchronized playback. */
export function presentationScenarioKey(presentation: BrowserBundlePresentation): string {
  return `${presentation.source.sha256}:${presentation.stepSignature}`;
}

/** Seed controlling this presentation's visual choices. */
export function presentationViewSeed(presentation: BrowserBundlePresentation): number {
  return presentation.seed;
}

/** Wrap a validated static fragment in the single iframe isolation policy used by every client. */
export function staticHtmlFrameDocument(html: string): string {
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "script-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}</style></head><body>${html}</body></html>`;
}
