<!--
  The page around every view, as the server renders it to lay each step out and draw its scenes
  (see ../assembly/layout.ts and model/scene-of.ts): a canvas at a fixed logical size, centred and
  scaled to fit the window, that arranges what the layout shown holds in its root's row or column,
  the root drawn at the fit the server gave. Its edges are a dashed outline. It never runs in a
  browser: SceneView.svelte draws the scenes, and is what participants use.
-->
<script lang="ts">
  import type { Component } from 'svelte';

  import { layoutMemoryContext, provideNodeIds } from './type-context';
  import { alignments, fitShapes, frameRatios, frameWidth, justifications } from './node/scales';
  import type { FrameSettings } from './node/props';

  let {
    view: View,
    props,
    settings
  }: {
    /** The authored view. */
    view: Component<Record<string, unknown>>;
    /** The view's props: the step's state and the view each type draws. */
    props: Record<string, unknown>;
    settings: FrameSettings;
  } = $props();

  provideNodeIds();
  const memory = layoutMemoryContext();
  // The root is drawn at the fit the server gave, which holds every step's content in the frame's
  // inside (see shownFrame).
  const fit = memory?.frame?.fit ?? 1;
  const width = frameWidth;
  // As tall as the server gave; laid out there, a frame taking its content's shape is at its
  // tallest (see model/reserve.ts).
  const height = $derived(
    memory?.frame?.height ??
      (settings.ratio === 'fit'
        ? Math.round(width / fitShapes.tallest)
        : Math.round(frameWidth / frameRatios[settings.ratio]))
  );

  // The window the frame fits in, which the layout isolate gives a size (see ../assembly/layout.ts),
  // with a margin keeping the outline in view.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const margin = 16;
  const scale = $derived(
    viewport.width > 2 * margin && viewport.height > 2 * margin
      ? Math.min((viewport.width - 2 * margin) / width, (viewport.height - 2 * margin) / height)
      : 1
  );

  // The outline is drawn unscaled, just outside the frame, so its dashes keep their size.
  const edgeOffset = 6;
  const edgeWidth = 1;
  const edge = $derived({
    width: width * scale + 2 * edgeOffset,
    height: height * scale + 2 * edgeOffset
  });
</script>

<div class="sv-viewport">
  <div
    class="sv-frame"
    data-sv-node={settings.ref}
    data-sv-label="the page, as {settings.name}"
    style:width="{width}px"
    style:height="{height}px"
    style:transform="translate(-50%, -50%) translate(0px, 0px) scale({scale})"
    style:padding={`${settings.padding}em`}
    style:justify-content={justifications[settings.justify]}
    style:align-items={alignments[settings.align]}
  >
    <div class="sv-root" style:width="0px" style:height="0px">
      <div class="sv-root-inner" style:transform="scale({fit})">
        <!-- At least the frame's inside, so justify and align spread what fits. -->
        <div
          class="sv-flow"
          style:flex-direction={settings.layout}
          style:gap={`${settings.gap}em`}
          style:justify-content={justifications[settings.justify]}
          style:align-items={alignments[settings.align]}
          style:min-width={`calc(${width}px - 2 * ${settings.padding}em)`}
          style:min-height={`calc(${height}px - 2 * ${settings.padding}em)`}
        >
          <View {...props} />
        </div>
      </div>
    </div>
  </div>
  <svg
    class="sv-edge"
    width={edge.width}
    height={edge.height}
    style:transform="translate(-50%, -50%) translate(0px, 0px)"
    aria-hidden="true"
  >
    <rect
      x={edgeWidth / 2}
      y={edgeWidth / 2}
      width={edge.width - edgeWidth}
      height={edge.height - edgeWidth}
      rx="4"
      stroke-width={edgeWidth}
      stroke-dasharray="14 9"
    />
  </svg>
</div>

<style>
  .sv-viewport {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  /* Both are centred on the page by their own size; only the frame is scaled. */
  .sv-frame,
  .sv-edge {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .sv-frame {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    transform-origin: center;
    background: var(--sv-surface);
  }
  .sv-flow {
    display: flex;
    box-sizing: border-box;
    width: max-content;
  }
  /* An arranged root takes its scaled size, so the frame places it like any other block. */
  .sv-root {
    flex: none;
  }
  .sv-root-inner {
    transform-origin: top left;
  }
  .sv-edge {
    pointer-events: none;
    overflow: visible;
  }
  .sv-edge rect {
    fill: none;
    stroke: var(--sv-muted);
    stroke-opacity: 0.4;
  }
</style>
