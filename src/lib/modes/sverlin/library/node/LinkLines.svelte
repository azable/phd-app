<!--
  The lines of a node's links, inside the SVG drawn over it (see Arranged.svelte and
  LinkOverlay.svelte): each link's path with its heads at the ends its data points to, each head a
  marker of its kind's shape and size in the line's colour, and a wider invisible line along a link
  component, so it can be clicked and selected.
-->
<svelte:options namespace="svg" />

<script module lang="ts">
  import type { HeadEnds } from './heads';

  /** How a link is drawn: its kind's look, as CSS (see Link.svelte). */
  export type LineStyle = {
    strokeStyle?: 'dashed' | 'dotted';
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
    shown: boolean;
  };

  export type Line = {
    path: string;
    /** The link it draws, as written, such as 'a -> b'. */
    link: string;
    id?: string;
    heads: HeadEnds;
    head?: { shape: string; size: number };
    style?: LineStyle;
  };
</script>

<script lang="ts">
  import { linkDashes } from './design';
  import { headDrawing, headKey, type HeadLook } from './heads';

  let { lines, prefix }: { lines: readonly Line[]; prefix: string } = $props();

  // A link drawn by no <Link>, as a relation's, is a fine muted line.
  const colourOf = (style?: LineStyle) => style?.stroke ?? 'var(--sv-muted)';
  const pixels = (style?: LineStyle) => {
    const width = Number(style?.strokeWidth);
    return Number.isFinite(width) && style?.strokeWidth ? width : 2;
  };
  const lookOf = (line: Line): HeadLook | undefined =>
    headDrawing(line.head?.shape) && line.head
      ? {
          shape: line.head.shape,
          size: line.head.size,
          colour: colourOf(line.style),
          width: pixels(line.style)
        }
      : undefined;
  // Node ids hold : and #, which an SVG fragment reference cannot, and two steps' layers are in the
  // page while one replaces the other, so each drawing's markers are numbered under its own prefix.
  const looks = $derived([
    ...new Map(
      lines.flatMap((line) => {
        const look = lookOf(line);
        return look ? [[headKey(look), look] as const] : [];
      })
    ).values()
  ]);
  const markerOf = (line: Line) => {
    const look = lookOf(line);
    const index = look ? looks.findIndex((each) => headKey(each) === headKey(look)) : -1;
    return index < 0 ? undefined : `url(#${prefix}-${index})`;
  };
</script>

<defs>
  {#each looks as look, index (headKey(look))}
    {@const drawing = headDrawing(look.shape)}
    {#if drawing}
      <marker
        id="{prefix}-{index}"
        viewBox="0 0 10 10"
        refX={drawing.stops ? 0 : 10}
        refY="5"
        markerUnits="userSpaceOnUse"
        markerWidth={look.size}
        markerHeight={look.size}
        orient="auto-start-reverse"
        overflow="visible"
        data-shape={look.shape}
      >
        <path
          d={drawing.path}
          style:fill={drawing.filled ? look.colour : 'none'}
          style:stroke={drawing.filled ? 'none' : look.colour}
          stroke-width={(look.width * 10) / look.size}
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </marker>
    {/if}
  {/each}
</defs>
{#each lines as line, index (index)}
  {@const style = line.style}
  {@const marker = markerOf(line)}
  <path
    class="link"
    d={line.path}
    data-sv-edge={line.link}
    data-sv-edge-id={line.id}
    data-head={marker ? line.head?.shape : undefined}
    data-head-size={marker ? line.head?.size : undefined}
    style:stroke={colourOf(style)}
    style:stroke-width="{pixels(style)}px"
    style:opacity={style?.shown === false ? 0 : style?.opacity}
    data-stroke-style={style?.strokeStyle}
    stroke-dasharray={style?.strokeStyle ? linkDashes[style.strokeStyle].join(' ') : undefined}
    stroke-linecap={style?.strokeStyle === 'dotted' ? 'round' : undefined}
    marker-start={line.heads.start ? marker : undefined}
    marker-end={line.heads.end ? marker : undefined}
  />
  {#if line.id}
    <path
      class="hit"
      d={line.path}
      data-sv-node={line.id}
      data-sv-label={line.link.replace(' -> ', ' → ').replace(' - ', ' – ')}
    />
  {/if}
{/each}

<style>
  .link {
    fill: none;
    stroke: var(--sv-muted);
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12px;
    pointer-events: stroke;
  }
</style>
