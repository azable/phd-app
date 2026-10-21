/** Discover server-only mode builders by folder convention from the public catalogue. */

import { modeCatalog } from './catalog';
import type {
  DesignDraw,
  VisualizationMode,
  RenderablePresentation,
  VariantRequest
} from '$lib/shared/presentations';
import type { BuildDiagnostic } from '$lib/shared/projects/events/values';

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
        // Aligned modes: the master trace's identity, the master index of each kept step, and design values.
        masterSignature?: string;
        masterSteps?: number[];
        parameters?: Record<string, unknown>;
        draws?: DesignDraw[];
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

/** One presentation to build: the seed that places its layouts, and the values it starts from. */
export type BuildRequest = { seed: number; variant?: VariantRequest };

export type SourceBatchBuilder = (
  source: string,
  requests: readonly BuildRequest[],
  signal?: AbortSignal
) => Promise<ModeBuildResult[]>;

type ModeBuilders = {
  buildPresentation?: PresentationBuilder;
  buildBatch?: SourceBatchBuilder;
};

const modules = import.meta.glob<ModeBuilders>('./*/build.server.ts', {
  eager: true
});

export const modeBuilders = Object.fromEntries(
  Object.keys(modeCatalog).map((id) => [id, modules[`./${id}/build.server.ts`]])
) as Record<VisualizationMode, ModeBuilders>;

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
