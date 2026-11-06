/** Prepare a single component once, then bundle each request's variant and steps. */

import {
  bundlePresentation,
  InvalidSvelteSourceError,
  prepareSvelteComponent,
  type PreparedComponent,
  type SvelteBundle
} from './compile.server';
import type { BuildRequest, DesignKeys, ModeBuildResult } from '../server';
import { isToken, tokenProps } from './library/node/design';
import {
  flatDesign,
  keptKey,
  nestedDesign,
  writtenKey,
  writtenValues
} from './library/node/design-keys';

export { versionScenes as scenes } from './scenes.server';
export { exportFile } from './targets/export.server';
export { locateElement } from './element-ref';

/** How the design names its variables, for code outside the mode that reads variants (see ../server.ts). */
export const designKeys: DesignKeys = {
  kept: keptKey,
  written: writtenKey,
  tokenProp: (variable) => (isToken(variable) ? tokenProps[variable] : undefined),
  writtenNested: (values) => nestedDesign(writtenValues(values)),
  flat: flatDesign
};

/** Text cut to what a presentation stores, as presentations.ts bounds it, so a long warning never fails the turn. */
const within = (most: number) => (text: string) =>
  text.length > most ? `${text.slice(0, most - 1)}…` : text;

export async function buildBatch(
  source: string,
  requests: readonly BuildRequest[],
  signal?: AbortSignal
): Promise<ModeBuildResult[]> {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  throwIfAborted(signal);
  let prepared: PreparedComponent;
  try {
    prepared = prepareSvelteComponent(source);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return requests.map(({ seed }) => failure(seed, cause, elapsed()));
  }
  const results: ModeBuildResult[] = [];
  for (const [index, { seed, variant }] of requests.entries()) {
    throwIfAborted(signal);
    try {
      // Every step laid out here, so the page mounts only the step it shows (see layout.server.ts);
      // the first of a batch, the version a reply shows or a comparison's first side, measured in
      // its other arrangements too (see arrangements.server.ts).
      const bundle = await bundlePresentation(prepared, seed, variant, { arrange: index === 0 });
      logLayout(seed, bundle.layout);
      results.push({
        ok: true,
        seed,
        durationMs: elapsed(),
        bundle: {
          mode: 'sverlin',
          html: '',
          javascript: bundle.javascript,
          labels: bundle.labels,
          steps: bundle.steps,
          stepSignature: bundle.stepSignature,
          variant: bundle.variant,
          origins: bundle.origins,
          views: prepared.design.views,
          pointers: prepared.design.pointers,
          listings: prepared.ownListings,
          kinds: prepared.design.tags,
          roles: prepared.design.roles,
          renders: prepared.design.renders,
          leftOut: bundle.leftOut,
          ...(bundle.warnings ? { warnings: bundle.warnings.slice(0, 200).map(within(1000)) } : {}),
          runs: prepared.pauses.runs,
          structures: prepared.design.structures,
          ...(bundle.layout.drawn ? { drawn: bundle.layout.drawn } : {}),
          ...(bundle.layout.readability ? { readability: bundle.layout.readability } : {}),
          ...(bundle.layout.arrangements ? { arrangements: bundle.layout.arrangements } : {}),
          ...(bundle.layout.drawing ? { drawing: within(1000)(bundle.layout.drawing) } : {})
        }
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      results.push(failure(seed, cause, elapsed()));
    }
  }
  return results;
}

/** How long the server took to lay a presentation out; one the view failed to draw fails its build. */
function logLayout(seed: number, layout: SvelteBundle['layout']): void {
  console.info(
    `[sverlin] seed ${seed} laid out on the server in ${layout.ms} ms${layout.cached ? ' (kept)' : ''}`
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Build cancelled.', 'AbortError');
}

function failure(seed: number, cause: unknown, durationMs: number): ModeBuildResult {
  // A source error can stand for several problems found together; each is its own diagnostic.
  const problems = cause instanceof InvalidSvelteSourceError ? [cause, ...cause.others] : [cause];
  const messages = problems.map((problem) =>
    problem instanceof Error ? problem.message : String(problem)
  );
  return {
    ok: false,
    seed,
    durationMs,
    error: messages.join('\n'),
    diagnostics: problems.map((problem, index) => ({
      severity: 'error',
      message: messages[index],
      raw: messages[index],
      sourcePath: 'Main.svelte',
      ...(problem instanceof InvalidSvelteSourceError
        ? {
            code: problem.code,
            line: problem.line,
            column: problem.column,
            endLine: problem.endLine,
            endColumn: problem.endColumn
          }
        : {})
    })),
    failureKind: cause instanceof InvalidSvelteSourceError ? 'source' : 'infrastructure'
  };
}
