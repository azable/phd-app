/** Prepare a single component once, then bundle each requested seed's design and steps. */

import {
  bundlePresentation,
  InvalidSvelteSourceError,
  prepareSvelteComponent,
  type PreparedComponent
} from './compile.server';
import type { ModeBuildResult } from '../server';

export async function buildBatch(
  source: string,
  seeds: readonly number[],
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
    return seeds.map((seed) => failure(seed, cause, elapsed()));
  }
  const results: ModeBuildResult[] = [];
  for (const seed of seeds) {
    throwIfAborted(signal);
    try {
      const bundle = await bundlePresentation(prepared, seed);
      results.push({
        ok: true,
        seed,
        durationMs: elapsed(),
        bundle: {
          mode: 'sverlin',
          html: '',
          javascript: bundle.javascript,
          labels: bundle.labels,
          masterLabels: bundle.masterLabels,
          masterSteps: bundle.masterSteps,
          parameters: bundle.parameters
        }
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      results.push(failure(seed, cause, elapsed()));
    }
  }
  return results;
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
