<!--
  The links of a node laid out in a row or column, drawn over it. They take no part in its layout:
  the node places its children as it would without them, and each link is drawn afterwards between
  the boxes of the elements its ends name, inside the node, as an arc that clears the boxes between
  and around them, over ends side by side or to the right of ends one above the other, or as a wire
  round them; its label sits on its middle. Links in a free layout are placed with their nodes
  instead (see Arranged.svelte).
-->
<script lang="ts">
  import { headTrim } from './heads';
  import LinkLines, { type Line } from './LinkLines.svelte';
  import { labelsIn, markerLook, placeLabel } from './markers';
  import { curvePath, routeCurve, wirePath, type Box } from './route';
  import { seenParts, unionOf } from './visible';
  import { routeWires } from './wires';

  let { axis }: { axis: 'row' | 'column' } = $props();

  let svg = $state<SVGSVGElement>();
  let drawn = $state<Line[]>([]);
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
        child instanceof HTMLElement &&
        !child.hasAttribute('data-sv-link') &&
        !child.hasAttribute('data-sv-link-label')
    );
    const markers = [...host.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.hasAttribute('data-sv-link') &&
        !child.hasAttribute('data-sv-hoist')
    );
    const labels = labelsIn(host);
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
    const linked = markers.flatMap((marker) => {
      const from = anchors[marker.dataset.from ?? ''];
      const to = anchors[marker.dataset.to ?? ''];
      return from && to && from !== to ? [{ marker, from, to, ...markerLook(marker) }] : [];
    });
    // Wires are routed together round the cells, so their runs keep apart: each between the cells
    // holding its ends, or the boxes inside them it meets.
    const cellOf = (end: Box) => boxes.findIndex((box) => overlaps(box, end));
    const wired = linked.filter(
      ({ route, from, to }) =>
        route === 'wire' && cellOf(from) >= 0 && cellOf(to) >= 0 && cellOf(from) !== cellOf(to)
    );
    const same = (a: Box, b: Box) => a.left === b.left && a.top === b.top && a.right === b.right;
    const inner = boxes.map(() => [] as Box[]);
    for (const { from, to } of wired)
      for (const end of [from, to]) {
        const cell = boxes[cellOf(end)];
        const ends = inner[cellOf(end)];
        if (!same(cell, end) && !ends.some((each) => same(each, end))) ends.push(end);
      }
    const wireEnd = (end: Box) => {
      const ends = inner[cellOf(end)];
      const at = ends.findIndex((each) => same(each, end));
      return { child: cellOf(end), ...(ends.length ? { end: Math.max(0, at) } : {}) };
    };
    const wires = new Map(
      routeWires(
        boxes.map((box, cell) => ({ box, ends: inner[cell] })),
        wired.map(({ from, to }) => ({ from: wireEnd(from), to: wireEnd(to) }))
      ).map((corners, i) => [wired[i], corners])
    );
    drawn = linked.map((link) => {
      const { marker, from, to, route, head } = link;
      const { dataset } = marker;
      const directed = dataset.directed !== 'false';
      const heads = { start: !directed, end: true };
      const trim = {
        start: heads.start ? headTrim(head?.shape, head?.size ?? 0) : 0,
        end: headTrim(head?.shape, head?.size ?? 0)
      };
      const corners = wires.get(link);
      let path: string;
      let middle: { x: number; y: number };
      if (corners?.length) ({ path, middle } = wirePath(corners, trim));
      else {
        const [p, q] = [centre(from), centre(to)];
        // Ends side by side arc over them, ends one above the other beside them, wherever the link
        // is written: a link in a column can join two cells of a row inside it.
        const wide = Math.abs(q.x - p.x);
        const tall = Math.abs(q.y - p.y);
        const sideBySide = wide === tall ? axis === 'row' : wide > tall;
        const across = sideBySide ? q.x - p.x : q.y - p.y;
        // A straight link runs straight; else it arcs over ends side by side, or to the right of
        // ends one above the other, further where the first arc would cross a box.
        const order =
          route === 'straight'
            ? [0]
            : across
              ? [-0.8, -1.1].map((amount) => amount * Math.sign(across))
              : [0.3, -0.3];
        const obstacles = boxes.filter((box) => !overlaps(box, from) && !overlaps(box, to));
        const routed = routeCurve(from, to, obstacles, order);
        path = curvePath(routed.curve, trim).path;
        middle = routed.halfway;
      }
      const label = dataset.svLink ? labels.get(dataset.svLink) : undefined;
      if (label) placeLabel(host, label, middle);
      return {
        path,
        link: `${dataset.from}${directed ? ' -> ' : ' - '}${dataset.to}`,
        ...(dataset.svLink ? { id: dataset.svLink } : {}),
        heads,
        ...(head ? { head } : {}),
        style: link.style
      };
    });
  };

  $effect(() => {
    const host = svg?.parentElement;
    if (!host) return;
    host.dataset.svOverlaid = '';
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
