/** Prepare a single component once, then bundle each request's variant and steps. */

import {
  bundlePresentation,
  InvalidSvelteSourceError,
  prepareSvelteComponent,
  type PreparedComponent,
  type SvelteBundle
} from './compile.server';
import type { BuildRequest, ModeBuildResult } from '../server';

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
  for (const { seed, variant } of requests) {
    throwIfAborted(signal);
    try {
      // Every step laid out here, so the page mounts only the step it shows (see layout.server.ts).
      const bundle = await bundlePresentation(prepared, seed, variant, {
        serverLayout: serverLayoutEnabled()
      });
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
          masterSignature: bundle.masterSignature,
          masterSteps: bundle.masterSteps,
          variant: bundle.variant,
          origins: bundle.origins,
          views: prepared.design.views,
          pointers: prepared.design.pointers,
          listings: prepared.ownListings,
          kinds: prepared.design.tags,
          renders: prepared.design.renders,
          leftOut: bundle.leftOut,
          runs: prepared.pauses.runs,
          structures: prepared.design.structures,
          ...(bundle.layout?.drawn ? { drawn: bundle.layout.drawn } : {})
        }
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      results.push(failure(seed, cause, elapsed()));
    }
  }
  return results;
}

/** Where the server could not lay a presentation out, and why, as the page then lays it out. */
function logLayout(seed: number, layout: SvelteBundle['layout']): void {
  if (!layout) return;
  const errors = layout.errors.length ? `; the view failed at ${layout.errors.join('; ')}` : '';
  if (layout.server)
    console.info(
      `[sverlin] seed ${seed} laid out on the server in ${layout.ms} ms${layout.cached ? ' (kept)' : ''}${errors}`
    );
  else
    console.warn(`[sverlin] seed ${seed} left to the page to lay out: ${layout.failure}${errors}`);
}

/** Whether builds lay every step out on the server; tests of commands, which never read the layout, turn it off. */
function serverLayoutEnabled(): boolean {
  return process.env.SVERLIN_SERVER_LAYOUT !== 'off';
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
