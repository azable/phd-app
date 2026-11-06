/** Mode-neutral presentation, layout, and HTML-frame contracts. */

import * as v from 'valibot';
import { modeCatalog } from '$lib/modes/catalog';
import { arrangementSchema, readabilitySchema } from '$lib/shared/readability';

import { positiveSchema, recordedTextSchema, textSchema } from './projects/events/values';

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

/** A value a variable of a design space takes. */
export const designValueSchema = v.union([
  v.pipe(v.string(), v.maxLength(200)),
  v.number(),
  v.boolean()
]);

/** A variant: every variable of a source's design space, by key, as IntCell.fill. */
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

/** A presentation's variant, by key; empty for one with no design space. */
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
  /**
   * Every step its source can show, in order, by name, which its labels are some of (see
   * alignPresentationFrames); absent for a mode whose versions are never shown together. A step
   * stored with several names, before two labels could no longer mark the same code, is read by its
   * innermost, the last.
   */
  steps: v.optional(
    v.pipe(
      v.array(
        v.union([
          textSchema,
          v.pipe(
            v.array(textSchema),
            v.minLength(1),
            v.transform((names) => names[names.length - 1])
          )
        ])
      ),
      v.minLength(1)
    )
  ),
  /** Its variant: every variable of the source's design space, by key. */
  variant: v.optional(designValuesSchema),
  /** Where each of the variant's values came from. */
  origins: v.optional(v.record(v.string(), designOriginSchema)),
  /** The views each type rendered by name could draw, the options of its views variable. */
  views: v.optional(v.record(v.string(), v.array(v.pipe(v.string(), v.maxLength(200))))),
  /** The source's own listings, the first options of its listing.language variable. */
  listings: v.optional(v.array(v.pipe(v.string(), v.maxLength(200)))),
  /** The kind of each tag, by its line:column, as the editor shows it. */
  kinds: v.optional(v.record(v.string(), v.array(v.pipe(v.string(), v.maxLength(200))))),
  /** Each kind of node's role, by its key, whose role levels (role.value.padding) its props follow. */
  roles: v.optional(
    v.record(v.pipe(v.string(), v.maxLength(200)), v.pipe(v.string(), v.maxLength(40)))
  ),
  /** The variable each render of a type by name reads, as views.Int, by its line:column. */
  renders: v.optional(v.record(v.string(), v.pipe(v.string(), v.maxLength(200)))),
  /** The <Node> tags it leaves out, by their line:column, as the editor greys them. */
  leftOut: v.optional(v.array(v.pipe(v.string(), v.maxLength(20)))),
  /** How large it draws on a typical stage, where the server laid it out. */
  readability: v.optional(readabilitySchema),
  /** Other arrangements of its free layouts, laid out by the server, for the assistant. */
  arrangements: v.optional(v.pipe(v.array(arrangementSchema), v.maxLength(16))),
  /** Each step a scene leaves out, drawing what the step before it drew, for the assistant. */
  warnings: v.optional(v.pipe(v.array(v.pipe(v.string(), v.maxLength(1000))), v.maxLength(200))),
  /** What it draws, in kinds and links, from the server's layout (modes/sverlin/library/drawing.ts). */
  drawing: v.optional(v.pipe(v.string(), v.maxLength(1000))),
  generationEventId: v.optional(positiveSchema)
});

/** Any steppable presentation accepted by the workspace. */
export const renderablePresentationSchema = v.variant('format', [
  htmlFramesPresentationSchema,
  browserBundlePresentationSchema
]);

export type VisualizationMode = v.InferOutput<typeof visualizationModeSchema>;
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
 * A Sverlin step's name, the same however its steps pause: the stop of a run it is at, a label's
 * full name and which run of it, the nth of that label's runs to begin, as @insert.swap#1 for the
 * run's end and @insert.swap#1:before for just before it begins, or the whole run's, :before or
 * :after; in a storyboard of several scenes, after its scene (see sceneOfLabel), as one-merge:
 * @sort.merge#1. Events saved earlier name the whole run's start and end.
 */
export const stepNameSchema = v.pipe(
  v.string(),
  v.maxLength(200),
  v.regex(
    /^(?:[A-Za-z][\w-]*(?: \([^():]*\))?: )?(?::before|:after|start|end|@[\w.]+#\d+(?::before)?)$/u
  )
);

/**
 * The scene a Sverlin step's label names, in a storyboard of several: its name, its title, and the
 * step's own name, none for a single frame.
 */
export function sceneOfLabel(
  label: string | undefined
): { scene: string; title?: string; step?: string } | undefined {
  const parts = /^([A-Za-z][\w-]*)(?: \(([^():]*)\))?(?:: (.+))?$/u.exec(label ?? '');
  if (!parts || (parts[3] === undefined && /^(?:start|end)$/u.test(parts[1]))) return undefined;
  return {
    scene: parts[1],
    ...(parts[2] ? { title: parts[2] } : {}),
    ...(parts[3] ? { step: parts[3] } : {})
  };
}

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
 * Align presentations for playback. One plays its own steps. Several must come from one source,
 * sharing its steps (see BrowserBundlePresentation.steps): each step shows where its name falls among
 * them, and a presentation that omits a step holds its previous one.
 */
export function alignPresentationFrames(
  presentations: readonly RenderablePresentation[]
): AlignedFrame[] {
  const labels = presentations.map(presentationStepLabels);
  if (presentations.length === 1) {
    const [{ presentationId }] = presentations;
    return labels[0].map((label, step) => ({
      label,
      localSteps: { [presentationId]: step },
      held: []
    }));
  }
  const places = presentations.map((presentation, index) =>
    sourcePlaces(presentation, labels[index], presentations[0].stepSignature)
  );
  const shared = [...new Set(places.flat())].toSorted((left, right) => left - right);
  return shared.map((place) => {
    const localSteps: Record<string, number> = {};
    const held: string[] = [];
    let label = '';
    presentations.forEach(({ presentationId }, index) => {
      const own = places[index];
      const local = Math.max(
        own.findLastIndex((at) => at <= place),
        0
      );
      localSteps[presentationId] = local;
      if (own[local] === place) label ||= labels[index][local];
      else held.push(presentationId);
    });
    return { label, localSteps, held };
  });
}

/**
 * Where each of a presentation's steps falls among its source's steps, by name; an error for one
 * without them, from another source, or with a step they do not name in order.
 */
function sourcePlaces(
  presentation: RenderablePresentation,
  labels: readonly string[],
  signature: string
): number[] {
  if (
    presentation.format !== 'browser-bundle-v1' ||
    !presentation.steps ||
    presentation.stepSignature !== signature
  )
    throw new Error('Presentations shown together must come from one source and share its steps.');
  const places = stepPlaces(presentation.steps, labels);
  if (!places)
    throw new Error(
      `Presentation ${presentation.presentationId}'s steps are not its source's steps in order.`
    );
  return places;
}

/**
 * Where each step named falls among a source's steps (see BrowserBundlePresentation.steps); none
 * where one is not among them, or not in order.
 */
export function stepPlaces(
  steps: readonly string[],
  labels: readonly string[]
): number[] | undefined {
  const placeOf = new Map(steps.map((name, place): [string, number] => [name, place]));
  const places = labels.map((label) => placeOf.get(label) ?? -1);
  return places.every((place, index) => place >= 0 && (index === 0 || place > places[index - 1]))
    ? places
    : undefined;
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
