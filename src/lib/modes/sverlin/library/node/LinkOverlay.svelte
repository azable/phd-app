<!--
  The links of a node laid out in a row or column, drawn over it. They take no part in placing its
  children: the node places them as it would without links, and each link is drawn afterwards
  between the boxes of the elements its ends name, inside the node, as an arc that clears the boxes
  between and around them, over ends side by side or to the right of ends one above the other, or
  as a wire round them; its label sits on its middle. The node's padding grows to hold what they
  draw past its children, so nothing beside it, nor the frame's edge, cuts them off. Links in a
  free layout are placed with their nodes instead (see Arranged.svelte).
-->
<script lang="ts">
  import { headDrawing, headTrim } from './heads';
  import LinkLines, { type Line } from './LinkLines.svelte';
  import { labelsIn, markerLook, placeLabels, type PlacedLabel } from './markers';
  import { mountedReader } from './reader';
  import { curvePath, pathBounds, routeCurve, wirePath, type Box } from './route';
  import { seenParts, unionOf } from './visible';
  import { routeWires } from './wires';

  let { axis }: { axis: 'row' | 'column' } = $props();

  let svg = $state<SVGSVGElement>();
  let drawn = $state<Line[]>([]);
  // Node ids hold : and #, which an SVG fragment reference cannot, and two steps' layers are in the
  // page while one replaces the other, so each overlay's arrowheads are named apart.
  const instance = $props.id();
  const markerId = `sv-overlay-arrow-${instance}`;
  // Room added round the host's own padding for what its links draw outside it, which the host's
  // padding then holds, so whatever is placed beside the host, and the frame's fit, take it in.
  let room = { top: 0, right: 0, bottom: 0, left: 0 };
  let padding: typeof room | undefined;

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
    const read = mountedReader(host);
    const labels = labelsIn(read, host);
    // An end names the node drawing an element of the state, the outermost first, met where it is
    // seen (see visible.ts).
    const anchors: Record<string, Box> = {};
    for (const child of children)
      for (const inner of [child, ...child.querySelectorAll<HTMLElement>('[data-sv-slot]')]) {
        const name = inner.dataset.svSlot;
        if (name && !(name in anchors)) anchors[name] = unionOf(seenParts(read, inner).map(boxOf));
      }
    const boxes = children.map(boxOf);
    const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
    const overlaps = (a: Box, b: Box) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const linked = markers.flatMap((marker) => {
      const from = anchors[marker.dataset.from ?? ''];
      const to = anchors[marker.dataset.to ?? ''];
      return from && to && from !== to
        ? [{ marker, from, to, ...markerLook((name) => marker.getAttribute(name) ?? undefined) }]
        : [];
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
    const placed: PlacedLabel[] = [];
    const reached: Box[] = [];
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
      let ends: { start: { x: number; y: number }; end: { x: number; y: number } };
      if (corners?.length) ({ path, middle, ...ends } = wirePath(corners, trim));
      else {
        const [p, q] = [centre(from), centre(to)];
        // Ends side by side arc over them, ends one above the other beside them, wherever the link
        // is written: a link in a column can join two cells of a row inside it.
        const wide = Math.abs(q.x - p.x);
        const tall = Math.abs(q.y - p.y);
        const sideBySide = wide === tall ? axis === 'row' : wide > tall;
        const across = sideBySide ? q.x - p.x : q.y - p.y;
        // A straight link runs straight; else it arcs over ends side by side, or to the right of
        // ends one above the other, further where the first arc would cross a box. Ends far apart
        // arc about as high as their boxes, not in proportion to how far apart they are, so the
        // room the host keeps for the arc stays small.
        const extent = sideBySide
          ? Math.max(from.bottom - from.top, to.bottom - to.top)
          : Math.max(from.right - from.left, to.right - to.left);
        const low = Math.min(0.8, extent / Math.hypot(wide, tall));
        const order =
          route === 'straight'
            ? [0]
            : across
              ? [...new Set([low, Math.min(0.8, low * 1.5), 0.8, 1.1])].map(
                  (amount) => -amount * Math.sign(across)
                )
              : [0.3, -0.3];
        const obstacles = boxes.filter((box) => !overlaps(box, from) && !overlaps(box, to));
        const routed = routeCurve(from, to, obstacles, order);
        ({ path, ...ends } = curvePath(routed.curve, trim));
        middle = routed.halfway;
      }
      const label = dataset.svLink ? labels.get(dataset.svLink) : undefined;
      if (label) placed.push({ label, middle });
      reached.push(pathBounds(path));
      const reach = headDrawing(head?.shape) ? (head?.size ?? 0) : 0;
      for (const { x, y } of [...(heads.start ? [ends.start] : []), ends.end])
        if (reach)
          reached.push({ left: x - reach, top: y - reach, right: x + reach, bottom: y + reach });
      if (label)
        reached.push({
          left: middle.x - label.offsetWidth / 2,
          top: middle.y - label.offsetHeight / 2,
          right: middle.x + label.offsetWidth / 2,
          bottom: middle.y + label.offsetHeight / 2
        });
      return {
        path,
        link: `${dataset.from}${directed ? ' -> ' : ' - '}${dataset.to}`,
        ...(dataset.svLink ? { id: dataset.svLink } : {}),
        heads,
        ...(head ? { head } : {}),
        style: link.style
      };
    });
    placeLabels(host, placed);
    // The children move inside the host's new padding, so the links are drawn again from there.
    if (holdReached(host, boxes, reached)) measure(host);
  };

  // Each side needs room for what its links draw past the children there, beyond the host's own
  // padding: measured from the children, it stays the same once added, wherever they sit inside.
  const holdReached = (host: HTMLElement, children: readonly Box[], reached: readonly Box[]) => {
    const style = getComputedStyle(host);
    padding ??= {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft)
    };
    // How far what the links draw reaches past the children on a side, outward from the host.
    const past = (side: keyof Box, outward: 1 | -1) => {
      const farthest = (boxes: readonly Box[]) =>
        Math.max(...boxes.map((box) => outward * box[side]));
      return children.length && reached.length ? farthest(reached) - farthest(children) : 0;
    };
    const needed = {
      top: Math.max(0, past('top', -1) - padding.top),
      right: Math.max(0, past('right', 1) - padding.right),
      bottom: Math.max(0, past('bottom', 1) - padding.bottom),
      left: Math.max(0, past('left', -1) - padding.left)
    };
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    if (sides.every((side) => Math.abs(needed[side] - room[side]) < 0.01)) return false;
    room = needed;
    for (const side of sides)
      host.style.setProperty(`padding-${side}`, `${padding[side] + room[side]}px`);
    return true;
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
