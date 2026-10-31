<!--
  The links of a node laid out in a row or column, drawn over it. They take no part in placing its
  children: the node places them as it would without links, and each link is drawn afterwards
  between the boxes of the elements its ends name, inside the node, as an arc that clears the boxes
  between and around them, over ends side by side or to the right of ends one above the other, or
  as a wire round them; its label sits on its middle. The node's padding grows to hold what they
  draw past its children, so nothing beside it, nor the frame's edge, cuts them off (see
  overlay.ts). Links in a free layout are placed with their nodes instead (see Arranged.svelte).
-->
<script lang="ts">
  import LinkLines, { type Line } from './LinkLines.svelte';
  import { placeLabels } from './markers';
  import { overlayRoom, routeOverlay, type Sides } from './overlay';
  import { mountedReader, type Reader } from './reader';

  let { axis }: { axis: 'row' | 'column' } = $props();

  let svg = $state<SVGSVGElement>();
  let drawn = $state<Line[]>([]);
  // Node ids hold : and #, which an SVG fragment reference cannot, and two steps' layers are in the
  // page while one replaces the other, so each overlay's arrowheads are named apart.
  const instance = $props.id();
  const markerId = `sv-overlay-arrow-${instance}`;
  // Room added round the host's own padding for what its links draw outside it, which the host's
  // padding then holds, so whatever is placed beside the host, and the frame's fit, take it in.
  let room: Sides = { top: 0, right: 0, bottom: 0, left: 0 };
  let padding: Sides | undefined;

  /**
   * The host's elements, each where it is laid out in the host, in its own units, ignoring
   * transforms: values moving between cells are animated by transforms, and the arrow joins the
   * cells, not them.
   */
  const readerOf = (host: HTMLElement): Reader<HTMLElement> => ({
    ...mountedReader(host),
    boxIn(element) {
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
      return { x: left, y: top, width: element.offsetWidth, height: element.offsetHeight };
    }
  });

  const measure = (host: HTMLElement) => {
    const { lines, labels, children, reached } = routeOverlay(readerOf(host), host, axis);
    drawn = lines;
    placeLabels(host, labels);
    const style = getComputedStyle(host);
    padding ??= {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft)
    };
    const needed = overlayRoom(children, reached, padding);
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    if (sides.every((side) => Math.abs(needed[side] - room[side]) < 0.01)) return;
    room = needed;
    for (const side of sides)
      host.style.setProperty(`padding-${side}`, `${padding[side] + room[side]}px`);
    // The children move inside the host's new padding, so the links are drawn again from there.
    measure(host);
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
</script>

<svg class="links" bind:this={svg} aria-hidden="true">
  <LinkLines prefix={markerId} lines={drawn} />
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
</style>
