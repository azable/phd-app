/** Environment-neutral server paths shared by development and packaged deployment. */

import path from 'node:path';

/** Absolute repository/application root. Packaged containers use a fixed work directory. */
export function runtimeRoot(): string {
  return path.resolve(process.env.SVERLIN_REPOSITORY_ROOT?.trim() || process.cwd());
}

/** Persistent local state shared with the single-server guard. */
export function runtimeStateDir(): string {
  return path.resolve(
    process.env.SVERLIN_STATE_DIR?.trim() || path.join(runtimeRoot(), '.local', 'state', 'sverlin')
  );
}

/**
 * The commit this server was built from: `SVERLIN_BUILD_SHA` where the deployment sets it, else
 * the commit Render gives every build and running service as `RENDER_GIT_COMMIT`
 * (https://render.com/docs/environment-variables#all-runtimes), else none.
 */
export function buildSha(): string | undefined {
  return (
    process.env.SVERLIN_BUILD_SHA?.trim() || process.env.RENDER_GIT_COMMIT?.trim() || undefined
  );
}
