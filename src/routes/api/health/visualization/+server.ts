import { json, type RequestHandler } from '@sveltejs/kit';

import { runtimeReadiness } from '$lib/server/runtime-state';
import { compileSvelteComponent } from '$lib/modes/sverlin/compile.server';
import { sverlinStarter } from '$lib/modes/sverlin/contract';

/** Run a real single-component compilation for an authenticated operator. */
export const POST: RequestHandler = async () => {
  const readiness = await runtimeReadiness();
  if (!readiness.ready) return json(readiness, { status: 503 });
  const start = performance.now();
  try {
    const bundle = await compileSvelteComponent(sverlinStarter.source, {
      chosen: { template: '$starter' }
    });
    return json(
      { ok: true, durationMs: Math.round(performance.now() - start), steps: bundle.labels.length },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (cause) {
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
};
