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

/**
 * One declaration in a presentation's design block, and the value it took: kept to read
 * presentations built while sources had design blocks.
 */
export const designDrawSchema = v.strictObject({
  key: v.string(),
  call: v.picklist(['pick', 'int', 'real', 'chance']),
  args: v.array(v.unknown()),
  value: v.unknown(),
  origin: v.optional(v.picklist(['chosen', 'kept'])),
  start: naturalSchema,
  end: naturalSchema
});

/** A value a variable of a design space takes. */
export const designValueSchema = v.union([
  v.pipe(v.string(), v.maxLength(200)),
  v.number(),
  v.boolean()
]);

/** A variant: every variable of a source's design space, by key, as Compared.Pointed.fill. */
export const designValuesSchema = v.record(v.pipe(v.string(), v.maxLength(200)), designValueSchema);
export type DesignValues = v.InferOutput<typeof designValuesSchema>;

/** Where a variant's value came from: chosen for the build, kept, drawn, or the starter's. */
export const designOriginSchema = v.picklist(['chosen', 'kept', 'random', 'starter']);

/**
 * The values a build starts from. Chosen values must each name a variable and be one of its
 * options. A base variant's values are kept where they still fit, and the starter gives the rest.
 * Randomise draws afresh: everything (true), keeping the base's equalities, or the variables named.
 */
export const variantRequestSchema = v.strictObject({
  chosen: v.optional(v.record(v.string(), v.unknown())),
  base: v.optional(v.record(v.string(), v.unknown())),
  randomise: v.optional(v.union([v.literal(true), v.array(v.string())]))
});
export type VariantRequest = v.InferOutput<typeof variantRequestSchema>;

/** A presentation's variant, by key; empty for one built before variants were recorded. */
export function presentationVariant(
  presentation: RenderablePresentation | undefined
): DesignValues {
  return presentation?.format === 'browser-bundle-v1' ? (presentation.variant ?? {}) : {};
}

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
  /** Its variant: every variable of the source's design space, by key. */
  variant: v.optional(designValuesSchema),
  /** Where each of the variant's values came from. */
  origins: v.optional(v.record(v.string(), designOriginSchema)),
  /** The views each type rendered by name could draw, the options of its views variable. */
  views: v.optional(v.record(v.string(), v.array(v.pipe(v.string(), v.maxLength(200))))),
  /** The pointer views each position type rendered as a pointer could draw, its pointers variable's. */
  pointers: v.optional(v.record(v.string(), v.array(v.pipe(v.string(), v.maxLength(200))))),
  /** The source's own listings, the first options of its listing.language variable. */
  listings: v.optional(v.array(v.pipe(v.string(), v.maxLength(200)))),
  /** The kind of each tag, by its line:column, as the editor shows it. */
  kinds: v.optional(v.record(v.string(), v.array(v.pipe(v.string(), v.maxLength(200))))),
  /** The variable each render of a type by name reads, views.Int or pointers.Index, by its line:column. */
  renders: v.optional(v.record(v.string(), v.pipe(v.string(), v.maxLength(200)))),
  /** The <Node> tags it leaves out, by their line:column, as the editor greys them. */
  leftOut: v.optional(v.array(v.pipe(v.string(), v.maxLength(20)))),
  /** Design values and draws of a presentation built while sources had design blocks. */
  parameters: v.optional(v.record(v.string(), v.unknown())),
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

/**
 * A Sverlin step's name, the same however its steps pause: a label's full name and which run of it
 * the step ends, as @insert.swap#1, or start or end. Older presentations label steps "Step n".
 */
export const stepNameSchema = v.pipe(
  v.string(),
  v.maxLength(200),
  v.regex(/^(?:start|end|@[\w.]+#\d+)$/u)
);

/** Whether a step's label is its name. */
export const isStepName = (label: string | undefined): label is string =>
  v.is(stepNameSchema, label);

/** The name of a presentation's step, where its label is one. */
export function presentationStepName(
  presentation: RenderablePresentation,
  step: number
): string | undefined {
  const label = presentationStepLabels(presentation)[step];
  return isStepName(label) ? label : undefined;
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
