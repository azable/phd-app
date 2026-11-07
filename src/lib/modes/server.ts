/** Discover server-only mode builders by folder convention from the public catalogue. */

import { buildLimit } from './build-limit.server';
import { modeCatalog } from './catalog';
import type {
  BrowserBundlePresentation,
  DesignValues,
  PresentationWarning,
  VisualizationMode,
  RenderablePresentation,
  VariantRequest
} from '$lib/shared/presentations';
import type { BuildDiagnostic } from '$lib/shared/projects/events/values';
import type { Arrangement, Readability } from '$lib/shared/readability';

export type PresentationBuilder = (
  source: string,
  seed: number,
  generationEventId?: number
) => Promise<RenderablePresentation>;

export type ModeBuildResult =
  | {
      ok: true;
      seed: number;
      durationMs: number;
      bundle: {
        mode: VisualizationMode;
        html: string;
        javascript: string;
        labels: string[];
        // Aligned modes: every step the source can show, by name, which the steps
        // kept are some of, and their identity.
        steps?: string[];
        stepSignature?: string;
        // Modes with a design space: the variant, where each value came from, and each type's views.
        variant?: DesignValues;
        // The design file the variant is built from.
        design?: DesignValues;
        origins?: Record<string, 'chosen' | 'kept' | 'random' | 'starter'>;
        views?: Record<string, string[]>;
        // The source's own listings, the first options of its <Listing>.language variable.
        listings?: string[];
        // The kind of each tag, by its line:column.
        kinds?: Record<string, string[]>;
        // The variable each render of a type by name reads, by its line:column.
        renders?: Record<string, string>;
        // The <Node> tags the presentation leaves out, by their line:column.
        leftOut?: string[];
        // What the build warns of, each with its code, for the assistant.
        warnings?: PresentationWarning[];
        // What it draws, in kinds and links, laid out on the server, for the assistant.
        drawing?: string;
        // Each label's spans, and how many change what the view draws, for the assistant.
        runs?: Record<string, { runs: number; drawn: number }>;
        // Each free layout kind's structure, as its data makes it, for the assistant.
        structures?: Record<string, string>;
        // What each step draws, laid out on the server, as a key alike for steps drawing the same
        // picture, so two presentations can be compared step by step; none where it was not.
        drawn?: string[];
        // How large it draws on a typical stage, laid out on the server; none where it was not.
        readability?: Readability;
        // Other arrangements of its free layouts, laid out on the server; none where not asked for.
        arrangements?: Arrangement[];
      };
    }
  | {
      ok: false;
      seed: number;
      durationMs: number;
      error: string;
      diagnostics: BuildDiagnostic[];
      failureKind: 'source' | 'infrastructure';
    };

/** One presentation to build: the seed that places its layouts and randomises, and the variant it starts from. */
export type BuildRequest = { seed: number; variant?: VariantRequest };

export type SourceBatchBuilder = (
  source: string,
  requests: readonly BuildRequest[],
  signal?: AbortSignal
) => Promise<ModeBuildResult[]>;

/**
 * Why a version has no scenes from the server, for the page to describe its own instead; `stale`
 * where an older app built it, so building it again from its source draws it (the rebuild command).
 */
export class UnavailableScenesError extends Error {
  override name = 'UnavailableScenesError';
  constructor(
    message: string,
    readonly stale = false
  ) {
    super(message);
  }
}

/**
 * Some steps of a version as scene data (all, where none are named), drawn on the server; throws
 * an UnavailableScenesError where it has none, for the page to describe its own.
 */
export type SceneSource = (
  presentation: BrowserBundlePresentation,
  steps?: readonly number[]
) => Promise<unknown>;

/** A file a version is exported as, made on the server: its name, media type and bytes. */
export type ExportedFile = { name: string; contentType: string; body: Uint8Array<ArrayBuffer> };

/**
 * A version exported as one of its mode's render targets (see render-targets.ts), made on the
 * server; undefined for a target the mode has none of. Throws an UnavailableScenesError where the
 * server has no scenes to make it from.
 */
export type ExportSource = (
  presentation: BrowserBundlePresentation,
  target: string
) => Promise<ExportedFile | undefined>;

/**
 * How a mode with a design space names its variables: as the app keeps them and as people and the
 * model write them, and which are tokens with the prop each holds.
 */
export type DesignKeys = {
  kept(key: string, has?: (key: string) => boolean): string;
  written(key: string, has?: (key: string) => boolean): string;
  tokenProp(variable: string): string | undefined;
  /** A variant's values as people and the model read them, nested by kind. */
  writtenNested(values: Readonly<Record<string, DesignValue>>): NestedDesign;
  /** A nested design as flat keys, a flat one as it is (the form a demo or the model may write). */
  flat(design: Readonly<Record<string, unknown>>): Record<string, unknown>;
};

type DesignValue = string | number | boolean;
/** Values nested by the parts of their keys, as `{ "IntCell": { "fill": "white" } }`. */
export type NestedDesign = { [key: string]: DesignValue | NestedDesign };

/** Where a selected element's id points in a version's source: its tag's line and column, and more. */
export type ElementLocation = {
  line: number;
  column: number;
  key?: string;
  occurrence: number;
  items: number[];
  markup: string;
};

type ModeBuilders = {
  buildPresentation?: PresentationBuilder;
  buildBatch?: SourceBatchBuilder;
  scenes?: SceneSource;
  exportFile?: ExportSource;
  designKeys?: DesignKeys;
  /** The tag in a version's source that drew a selected element, as its id names it. */
  locateElement?: (source: string, id: string, listingName?: string) => ElementLocation | undefined;
};

const modules = import.meta.glob<ModeBuilders>('./*/build.server.ts', {
  eager: true
});

/** Each mode's builders, every build waiting its turn under the shared build limit. */
export const modeBuilders = Object.fromEntries(
  Object.keys(modeCatalog).map((id) => [id, limited(modules[`./${id}/build.server.ts`])])
) as Record<VisualizationMode, ModeBuilders>;

/**
 * The design keys of the mode that has a design space, for code that reads variants without a
 * project's mode, as the preference model; keys pass unchanged where no mode has one. Only
 * Sverlin has a design space: a second would need the project's mode passed instead.
 */
export const designKeys: DesignKeys = (() => {
  const all = Object.values(modules).flatMap(({ designKeys }) => (designKeys ? [designKeys] : []));
  if (all.length > 1) throw new Error('More than one mode has a design space; pass the mode.');
  return (
    all[0] ?? {
      kept: (key) => key,
      written: (key) => key,
      tokenProp: () => undefined,
      writtenNested: (values) => ({ ...values }),
      flat: (design) => ({ ...design })
    }
  );
})();

function limited(builders: ModeBuilders | undefined): ModeBuilders | undefined {
  if (!builders) return undefined;
  const { buildPresentation, buildBatch, scenes, exportFile, designKeys, locateElement } = builders;
  return {
    ...(scenes && { scenes }),
    ...(exportFile && { exportFile }),
    ...(designKeys && { designKeys }),
    ...(locateElement && { locateElement }),
    ...(buildPresentation && {
      buildPresentation: (...options: Parameters<PresentationBuilder>) =>
        buildLimit.run(() => buildPresentation(...options))
    }),
    ...(buildBatch && {
      buildBatch: (...[source, requests, signal]: Parameters<SourceBatchBuilder>) =>
        buildLimit.run(() => buildBatch(source, requests, signal), signal)
    })
  };
}

for (const pathname of Object.keys(modules)) {
  const id = pathname.split('/').at(-2) ?? '';
  if (!(id in modeCatalog)) throw new Error(`Unregistered visualization mode folder ${id}.`);
}

for (const [id, registration] of Object.entries(modeCatalog)) {
  const module = modules[`./${id}/build.server.ts`];
  const supported =
    registration.authoring === 'source' ? module?.buildBatch : module?.buildPresentation;
  if (!supported) throw new Error(`Visualization mode ${id} needs a matching server builder.`);
}
