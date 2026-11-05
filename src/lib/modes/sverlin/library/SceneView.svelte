<!--
  A presentation's steps drawn as one SVG from their scene data (see scene-render.ts), in place of
  the mounted view: boxes, text, drawings and links in the frame's logical coordinates, fitted to the
  page as Frame.svelte fits its frame, and moved from one step's scene to the next by identity,
  measuring nothing on the page. A click selects the node under the pointer, Shift, Ctrl or Cmd
  adding or removing one, as on the mounted page.
-->
<script lang="ts">
  import { motionDuration } from './motion';
  import {
    drawnScene,
    ease,
    headShape,
    headTransform,
    sceneBetween,
    shapePath,
    strokeInside,
    type DrawnNode,
    type DrawnScene
  } from './scene-render';
  import type { SceneFrame, SceneStep, SceneText } from './scene';

  let {
    frame,
    selection = [],
    onselection,
    onsettled
  }: {
    frame: SceneFrame;
    selection?: readonly string[];
    /** Told the nodes selected, with what a selection names each by. */
    onselection?: (elements: { id: string; label: string }[]) => void;
    /** Told once a step's move has ended. */
    onsettled?: (step: number) => void;
  } = $props();

  // The scene moved to, the one moved from, and how far through the move it is.
  let target = $state<DrawnScene>({ nodes: [], links: [] });
  let origin = $state<DrawnScene | undefined>();
  let progress = $state(1);
  let shownStep = -1;
  let animation = 0;
  // svelte-ignore state_referenced_locally
  let selected = $state<string[]>([...selection]);

  const drawn = $derived(origin ? sceneBetween(origin, target, ease(progress)) : target);

  /** Show a step's scene, moving from the one shown, if any. */
  export function show(step: number, scene: SceneStep): void {
    cancelAnimationFrame(animation);
    const next = drawnScene(scene);
    const first = shownStep < 0;
    origin = first ? undefined : drawn;
    target = next;
    shownStep = step;
    if (first) {
      progress = 1;
      onsettled?.(step);
      return;
    }
    progress = 0;
    const started = performance.now();
    const tick = (now: number) => {
      progress = Math.min(1, (now - started) / motionDuration);
      if (progress < 1) animation = requestAnimationFrame(tick);
      else {
        origin = undefined;
        onsettled?.(step);
      }
    };
    animation = requestAnimationFrame(tick);
  }

  /** Show these nodes selected, as when the app opens a reference. */
  export function select(ids: readonly string[]): void {
    selected = [...ids];
  }

  // The canvas fills the page, and the frame fits inside it with a margin, as Frame.svelte fits it.
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
  let canvas = $state<HTMLDivElement>();
  $effect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      viewport = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });
  const margin = 16;
  const scale = $derived(
    viewport.width > 2 * margin && viewport.height > 2 * margin
      ? Math.min(
          (viewport.width - 2 * margin) / frame.width,
          (viewport.height - 2 * margin) / frame.height
        )
      : 1
  );

  function report() {
    const byId = new Map(target.nodes.map((node) => [node.id, node]));
    onselection?.(
      selected.flatMap((id) => {
        const node = byId.get(id);
        return node ? [{ id, label: node.label.slice(0, 120) }] : [];
      })
    );
  }

  function choose(event: MouseEvent) {
    const id = (event.target as Element | null)
      ?.closest<SVGElement>('[data-sv-node]')
      ?.getAttribute('data-sv-node');
    const adding = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!id) selected = adding ? selected : [];
    else if (adding)
      selected = selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
    else selected = [id];
    report();
  }

  const dash = (style: string | undefined, width: number) =>
    style === 'dashed'
      ? `${3 * width} ${2 * width}`
      : style === 'dotted'
        ? `0 ${2 * width}`
        : undefined;
  // Text is drawn as the page set it, in its font and case, centred in the box it filled there.
  const cased = (run: SceneText) => (run.case === 'uppercase' ? run.text.toUpperCase() : run.text);
  const rect = (node: DrawnNode) =>
    node.look.stroke && node.look.strokeWidth
      ? strokeInside(node.box, node.look.strokeWidth)
      : node.box;
  const selectedNodes = $derived(drawn.nodes.filter(({ id }) => selected.includes(id)));
</script>

{#snippet text(node: DrawnNode, overLinks: boolean)}
  {#each node.marks.filter((mark) => !!mark.overLinks === overLinks) as mark, i (i)}
    <rect
      x={mark.box.x}
      y={mark.box.y}
      width={mark.box.width}
      height={mark.box.height}
      rx={mark.radius ?? 0}
      fill={mark.fill ?? 'none'}
      stroke={mark.stroke ?? 'none'}
      stroke-width={mark.strokeWidth ?? 0}
      opacity={node.opacity}
    />
  {/each}
  {#each node.runs.filter((run) => !!run.overLinks === overLinks) as run, i (i)}
    <text
      x={run.box.x + run.box.width / 2}
      y={run.box.y + run.box.height / 2}
      text-anchor="middle"
      dominant-baseline="central"
      fill={run.color}
      font-family={run.font}
      font-size={run.fontSize}
      font-weight={run.fontWeight}
      font-variant={run.case === 'small-caps' ? 'small-caps' : undefined}
      text-decoration={run.decoration === 'strike' ? 'line-through' : run.decoration}
      textLength={run.box.width > 0 ? run.box.width : undefined}
      lengthAdjust="spacingAndGlyphs"
      opacity={node.opacity}>{cased(run)}</text
    >
  {/each}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  class="sv-scenes"
  bind:this={canvas}
  role="application"
  tabindex="-1"
  aria-label="Visualization canvas: click to select nodes"
  onclick={choose}
>
  <!-- The frame's dashed edge, unscaled and just outside it, as Frame.svelte draws it. -->
  <svg
    class="sv-scene-edge"
    width={frame.width * scale + 12}
    height={frame.height * scale + 12}
    aria-hidden="true"
  >
    <rect
      x="0.5"
      y="0.5"
      width={frame.width * scale + 11}
      height={frame.height * scale + 11}
      rx="4"
      stroke-dasharray="14 9"
    />
  </svg>
  <svg
    class="sv-scene"
    data-sv-scene="true"
    viewBox="0 0 {frame.width} {frame.height}"
    width={frame.width * scale}
    height={frame.height * scale}
    role="img"
    aria-label="The visualization at this step"
  >
    <rect width={frame.width} height={frame.height} fill={frame.background} />
    {#each drawn.nodes as node (node.id)}
      {@const box = rect(node)}
      <g data-sv-node={node.id} data-sv-kind={node.kind}>
        {#if node.look.fill || node.look.stroke}
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={node.look.radius ?? 0}
            fill={node.look.fill ?? 'transparent'}
            stroke={node.look.stroke ?? 'none'}
            stroke-width={node.look.strokeWidth ?? 0}
            stroke-dasharray={dash(node.look.strokeStyle, node.look.strokeWidth ?? 1)}
            opacity={node.opacity}
          />
        {:else}
          <!-- Clickable, though it paints nothing. -->
          <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="transparent" />
        {/if}
        {#each node.shapes as shape, i (i)}
          <path
            d={shapePath(shape)}
            fill={shape.fill ?? 'none'}
            stroke={shape.stroke ?? 'none'}
            stroke-width={shape.strokeWidth ?? 0}
            fill-rule={shape.evenOdd ? 'evenodd' : undefined}
            opacity={node.opacity}
          />
        {/each}
        {@render text(node, false)}
      </g>
    {/each}
    <g class="sv-scene-links">
      {#each drawn.links as link (link.key)}
        <g data-sv-link={link.key} opacity={link.opacity}>
          <path
            d={link.d}
            fill="none"
            stroke={link.stroke}
            stroke-width={link.strokeWidth}
            stroke-dasharray={dash(link.strokeStyle, link.strokeWidth)}
            stroke-linecap="round"
          />
          {#each link.heads as head, i (i)}
            {@const shape = headShape(head)}
            {#if shape}
              <path
                d={shape.path}
                transform={headTransform(head)}
                fill={shape.filled ? link.stroke : 'none'}
                stroke={shape.filled ? 'none' : link.stroke}
                stroke-width={(link.strokeWidth * 10) / head.size}
                stroke-linejoin="round"
              />
            {/if}
          {/each}
        </g>
      {/each}
    </g>
    {#each drawn.nodes as node (node.id)}
      {#if node.runs.some((run) => run.overLinks) || node.marks.some((mark) => mark.overLinks)}
        <g data-sv-node={node.id}>{@render text(node, true)}</g>
      {/if}
    {/each}
    {#each selectedNodes as node (node.id)}
      <rect
        class="sv-scene-selected"
        x={node.box.x - 2}
        y={node.box.y - 2}
        width={node.box.width + 4}
        height={node.box.height + 4}
        fill="none"
        stroke="#2563eb"
        stroke-width={2 / scale}
        pointer-events="none"
      />
    {/each}
  </svg>
</div>

<style>
  .sv-scenes {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .sv-scene {
    display: block;
  }
  .sv-scene-edge {
    position: absolute;
    pointer-events: none;
  }
  .sv-scene-edge rect {
    fill: none;
    stroke: var(--sv-muted);
    stroke-opacity: 0.4;
  }
</style>
