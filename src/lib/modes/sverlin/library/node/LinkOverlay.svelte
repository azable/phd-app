<!--
  The links of a node laid out in a row or column, drawn over it. They take no part in its layout:
  the node places its children as it would without them, and each link is drawn afterwards between
  the boxes of the elements its ends name, inside the node, as an arc that clears the boxes between
  and around them, over ends side by side or to the right of ends one above the other. Links in a
  free layout are placed with their nodes instead (see Arranged.svelte).
-->
<script lang="ts">
  import { linkDashes, strokeStyleCss } from './design';
  import { routeCurve, type Box } from './route';
  import { seenParts, unionOf } from './visible';

  let { axis }: { axis: 'row' | 'column' } = $props();

  type Drawn = {
    path: string;
    middle: { x: number; y: number };
    link: string;
    id?: string;
    directed: boolean;
    stroke?: string;
    strokeWidth?: string;
    strokeStyle?: 'dashed' | 'dotted';
    opacity?: string;
    shown: boolean;
    label?: string;
    labelColour?: string;
  };

  let svg = $state<SVGSVGElement>();
  let drawn = $state<Drawn[]>([]);
  // Node ids hold : and #, which an SVG fragment reference cannot, and two steps' layers are in the
  // page while one replaces the other, so each overlay's arrowheads are named apart.
  const instance = $props.id();
  const markerId = `sv-overlay-arrow-${instance}`;

  const measure = (host: HTMLElement) => {
    // Where an element is laid out in the host, in its own units, ignoring transforms: values
    // moving between cells are animated by transforms, and the arrow joins the cells, not them.
    const boxOf = (element: HTMLElement): Box => {
      let left = 0;
      let top = 0;
      let at: HTMLElement | null = element;
      while (at && at !== host) {
        left += at.offsetLeft;
        top += at.offsetTop;
        const parent = at.offsetParent as HTMLElement | null;
        if (parent && parent !== host && !host.contains(parent)) {
          left -= host.offsetLeft;
          top -= host.offsetTop;
          break;
        }
        at = parent;
      }
      return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
    };
    const children = [...host.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute('data-sv-link')
    );
    const markers = [...host.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.hasAttribute('data-sv-link') &&
        !child.hasAttribute('data-sv-hoist')
    );
    // An end names the node drawing an element of the state, the outermost first, met where it is
    // seen (see visible.ts).
    const anchors: Record<string, Box> = {};
    for (const child of children)
      for (const inner of [child, ...child.querySelectorAll<HTMLElement>('[data-sv-slot]')]) {
        const name = inner.dataset.svSlot;
        if (name && !(name in anchors)) anchors[name] = unionOf(seenParts(inner).map(boxOf));
      }
    const boxes = children.map(boxOf);
    const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
    const overlaps = (a: Box, b: Box) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    drawn = markers.flatMap(({ dataset }) => {
      const from = anchors[dataset.from ?? ''];
      const to = anchors[dataset.to ?? ''];
      if (!from || !to || from === to) return [];
      const [p, q] = [centre(from), centre(to)];
      // Ends side by side arc over them, ends one above the other beside them, wherever the link is
      // written: a link in a column can join two cells of a row inside it.
      const wide = Math.abs(q.x - p.x);
      const tall = Math.abs(q.y - p.y);
      const sideBySide = wide === tall ? axis === 'row' : wide > tall;
      const across = sideBySide ? q.x - p.x : q.y - p.y;
      // A straight link runs straight; else it arcs over ends side by side, or to the right of ends one
      // above the other, further where the first arc would cross a box.
      const order =
        dataset.curve === 'straight'
          ? [0]
          : across
            ? [-0.8, -1.1].map((amount) => amount * Math.sign(across))
            : [0.3, -0.3];
      const obstacles = boxes.filter((box) => !overlaps(box, from) && !overlaps(box, to));
      const routed = routeCurve(from, to, obstacles, order);
      const directed = dataset.directed !== 'false';
      return [
        {
          path: routed.path,
          middle: routed.halfway,
          link: `${dataset.from}${directed ? ' -> ' : ' - '}${dataset.to}`,
          ...(dataset.svLink ? { id: dataset.svLink } : {}),
          directed,
          stroke: dataset.stroke,
          strokeWidth: dataset.strokeWidth,
          strokeStyle: strokeStyleCss(dataset.strokeStyle),
          opacity: dataset.opacity,
          shown: dataset.shown !== 'false',
          label: dataset.label,
          labelColour: dataset.labelColour
        }
      ];
    });
  };

  $effect(() => {
    const host = svg?.parentElement;
    if (!host) return;
    let frame = requestAnimationFrame(() => measure(host));
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure(host));
    };
    const observer = new ResizeObserver(again);
    observer.observe(host);
    for (const child of host.children) observer.observe(child);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  const colourOf = (link: Drawn) => link.stroke ?? 'var(--sv-muted)';
  const widthOf = (link: Drawn) => {
    const pixels = Number(link.strokeWidth);
    return Number.isFinite(pixels) && link.strokeWidth ? `${pixels}px` : '2px';
  };
  const colours = $derived([...new Set(drawn.map(colourOf))]);
</script>

<svg class="links" bind:this={svg} aria-hidden="true">
  <defs>
    {#each colours as colour, index (colour)}
      <marker
        id="{markerId}-{index}"
        viewBox="0 0 10 10"
        refX="10"
        refY="5"
        markerUnits="userSpaceOnUse"
        markerWidth="9"
        markerHeight="9"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" style:fill={colour} />
      </marker>
    {/each}
  </defs>
  {#each drawn as link, index (index)}
    {@const colour = colourOf(link)}
    <path
      class="link"
      d={link.path}
      data-sv-edge={link.link}
      data-sv-edge-id={link.id}
      style:stroke={colour}
      style:stroke-width={widthOf(link)}
      style:opacity={link.shown ? link.opacity : 0}
      data-stroke-style={link.strokeStyle}
      stroke-dasharray={link.strokeStyle ? linkDashes[link.strokeStyle].join(' ') : undefined}
      stroke-linecap={link.strokeStyle === 'dotted' ? 'round' : undefined}
      marker-end={link.directed ? `url(#${markerId}-${colours.indexOf(colour)})` : undefined}
    />
    {#if link.id}
      <!-- A wider, invisible line along the link, so it can be clicked and selected. -->
      <path
        class="hit"
        d={link.path}
        data-sv-node={link.id}
        data-sv-label={link.label ?? link.link.replace(' -> ', ' → ').replace(' - ', ' – ')}
      />
    {/if}
    {#if link.label}
      <text
        class="label"
        x={link.middle.x}
        y={link.middle.y}
        style:fill={link.labelColour}
        style:opacity={link.shown ? link.opacity : 0}>{link.label}</text
      >
    {/if}
  {/each}
</svg>

<style>
  .links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .links .link {
    fill: none;
    stroke: var(--sv-muted);
    stroke-width: 1.5;
  }
  .links .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12px;
    pointer-events: stroke;
  }
  .links .label {
    font-size: 0.75em;
    fill: var(--sv-muted);
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
  }
</style>
