/**
 * How long a move between steps takes, in milliseconds (see SceneView.svelte): long enough to
 * follow two values swapping, short enough that stepping through at a reading pace never waits for
 * it. The next step finishes it at once.
 */
export const motionDuration = 400;
