<!--
  A presentation's steps drawn as one SVG from their scene data (see scene-render.ts), in place of
  the mounted view: boxes, text, drawings and links in the frame's logical coordinates, fitted to the
  page as Frame.svelte fits its frame, and moved from one step's scene to the next by identity,
  measuring nothing on the page. It is used as Frame.svelte is: a click selects the node under the
  pointer, or, on the frame's empty space, the page, Shift, Ctrl or Cmd adding or removing one, and
  dragging draws a box; the wheel zooms, dragging with the middle button or with Space held pans,
  and a double click on empty space resets; hovering a reference to a place outlines every other.
  The app's comments are drawn over the frame as numbered badges beside the elements they are on
  (see annotation-place.ts), or at their points: hovering one outlines its elements and previews
  its words, choosing it opens a card with them, and a comment being written opens its card beside
  the selection; a click reports where it fell in the frame.
-->
<script lang="ts">
  import { badgeAt, badgeSize, cardPlacement, commentAnchor, overlap } from './annotation-place';
  import { motionDuration } from './motion';
  import { glowHalo, shadows } from './node/design';
  import {
    drawnScene,
    headShape,
    headTransform,
    indexed,
    layoutsAround,
    planMove,
    selectableParts,
    sceneDuring,
    shapePath,
    strokeInside,
    type DrawnNode,
    type DrawnScene,
    type Move,
    type ShownStep
  } from './scene-render';
  import type { ArrangementLayout, SceneBox, SceneFrame, SceneStep, SceneText } from './scene';

  type CanvasView = { zoom: number; panX: number; panY: number };
  type Selected = { id: string; label: string; layouts: ArrangementLayout[]; place?: string };
  /** What a comment is on: elements, by id, a point in the frame, or both. */
  type CommentOn = { elements?: string[]; point?: Point };
  /**
   * A comment pinned at this step: its number, what it is on, and what it says; draft until sent,
   * highlighted while the app points at it.
   */
  type Pin = CommentOn & { n: number; text: string; draft?: boolean; highlighted?: boolean };

  let {
    frame,
    selection = [],
    pins: startPins = [],
    composing: startComposing,
    view,
    onselection,
    onpoint,
    oncomment,
    oncomposecancel,
    onview,
    onsettled
  }: {
    frame: SceneFrame;
    selection?: readonly string[];
    /** The comments pinned at the step shown. */
    pins?: readonly Pin[];
    /** What the comment being written is on, if one is. */
    composing?: CommentOn;
    /** Told where a click fell, in the frame's coordinates. */
    onpoint?: (point: Point) => void;
    /** Told the words of the comment written. */
    oncomment?: (text: string) => void;
    /** Told the comment being written was given up. */
    oncomposecancel?: () => void;
    /** The zoom and pan to start from, as the app restores them. */
    view?: Partial<CanvasView>;
    /** Told the nodes selected, with what a selection names each by and the layouts round each. */
    onselection?: (elements: Selected[]) => void;
    /** Told the zoom and pan once a gesture changes them. */
    onview?: (view: CanvasView) => void;
    /** Told once a step's move has ended. */
    onsettled?: (step: number) => void;
  } = $props();

  // The scene moved to, the move playing to it, and how far through the move it is (in time).
  let target = $state.raw<DrawnScene>(indexed([], []));
  let move = $state.raw<Move | undefined>();
  let progress = $state(1);
  let shownStep: ShownStep | undefined;
  let animation = 0;
  const maxSelected = 50;
  const maxLabel = 60;
  // svelte-ignore state_referenced_locally
  let selected = $state<string[]>(selection.slice(0, maxSelected));

  const drawn = $derived(move ? sceneDuring(move, progress) : target);

  /**
   * Show a step's scene, moving from the one shown, if any: a step back plays the move on from it
   * backwards (see planMove).
   */
  export function show(step: number, scene: SceneStep): void {
    cancelAnimationFrame(animation);
    const next = { step, scene: drawnScene(scene) };
    const planned = planMove(shownStep, next, move ? drawn : undefined);
    shownStep = next;
    target = next.scene;
    move = planned;
    if (!planned) {
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
        move = undefined;
        onsettled?.(step);
      }
    };
    animation = requestAnimationFrame(tick);
  }

  /** Show these nodes selected, as when the app opens a reference. */
  export function select(ids: readonly string[]): void {
    selected = ids.slice(0, maxSelected);
  }

  // svelte-ignore state_referenced_locally
  let pins = $state.raw<readonly Pin[]>(startPins);
  /** Show these comment pins, as the app sends them for the step shown. */
  export function annotate(next: readonly Pin[]): void {
    pins = next;
  }

  // svelte-ignore state_referenced_locally
  let composing = $state.raw<CommentOn | undefined>(startComposing);
  /** Open the card to write a comment on this, or close it. */
  export function compose(on: CommentOn | undefined): void {
    composing = on;
    if (on) opened = undefined;
    else draft = '';
  }
  // The comment whose card is open, by its number: one card at a time, a draft's included.
  let opened = $state<number>();
  // The comment whose badge the pointer or focus is on.
  let pointed = $state<number>();

  // The canvas fills the page, and the frame fits inside it with a margin, as Frame.svelte fits it.
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
  let canvas = $state<HTMLDivElement>();
  const margin = 16;
  const scale = $derived(
    viewport.width > 2 * margin && viewport.height > 2 * margin
      ? Math.min(
          (viewport.width - 2 * margin) / frame.width,
          (viewport.height - 2 * margin) / frame.height
        )
      : 1
  );

  const minZoom = 0.25;
  const maxZoom = 8;
  // svelte-ignore state_referenced_locally
  const restored =
    view && [view.zoom, view.panX, view.panY].every(Number.isFinite)
      ? (view as CanvasView)
      : { zoom: 1, panX: 0, panY: 0 };
  let zoom = $state(Math.min(Math.max(restored.zoom, minZoom), maxZoom));
  let panX = $state(restored.panX);
  let panY = $state(restored.panY);
  const shown = $derived(scale * zoom);
  // Where the frame's top left corner is on the canvas.
  const corner = $derived({
    x: viewport.width / 2 + panX - (frame.width * shown) / 2,
    y: viewport.height / 2 + panY - (frame.height * shown) / 2
  });
  /** A box in the frame's coordinates, on the canvas. */
  const onCanvas = (box: SceneBox) => ({
    left: corner.x + box.x * shown,
    top: corner.y + box.y * shown,
    width: box.width * shown,
    height: box.height * shown
  });

  type Point = { x: number; y: number };
  // The pointer gesture in progress: panning, or a press that becomes a click or a selection box.
  let gesture = $state<
    | { kind: 'pan'; pointer: number; last: Point }
    | {
        kind: 'select';
        pointer: number;
        start: Point;
        at: Point;
        node?: string;
        place?: string;
        additive: boolean;
      }
    | undefined
  >();
  let spaceHeld = $state(false);
  // A press only becomes a selection box once it has moved this far, so a click stays a click.
  const dragThreshold = 4;
  const area = $derived(
    gesture?.kind === 'select' &&
      Math.max(
        Math.abs(gesture.at.x - gesture.start.x),
        Math.abs(gesture.at.y - gesture.start.y)
      ) >= dragThreshold
      ? {
          left: Math.min(gesture.start.x, gesture.at.x),
          top: Math.min(gesture.start.y, gesture.at.y),
          right: Math.max(gesture.start.x, gesture.at.x),
          bottom: Math.max(gesture.start.y, gesture.at.y)
        }
      : undefined
  );

  function reportView() {
    onview?.({ zoom, panX, panY });
  }

  const selectable = $derived(selectableParts(target, frame));

  // Cut whole code points, so an emoji is never split into a lone surrogate the server refuses.
  const shortened = (label: string) =>
    label.length > maxLabel
      ? `${Array.from(label)
          .slice(0, maxLabel - 1)
          .join('')}…`
      : label;

  /** Select these parts; a click on a token's text, as a listing's :i[…], names its place too. */
  function setSelection(ids: string[], clicked?: { node: string; place: string }) {
    selected = [...new Set(ids)].slice(0, maxSelected);
    onselection?.(
      selected.flatMap((id) => {
        const part = selectable.get(id);
        return part
          ? [
              {
                id,
                label: shortened(part.label),
                layouts: layoutsAround(target, id),
                ...(clicked?.node === id ? { place: clicked.place } : {})
              }
            ]
          : [];
      })
    );
  }

  /** The innermost part at an event's target, if any. */
  const partAt = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest<SVGElement>('[data-sv-node]')?.getAttribute('data-sv-node') ?? undefined)
      : undefined;

  /** The first place the text at an event's target refers to, if it is a token's. */
  const placeAt = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest('text[data-sv-place]')?.getAttribute('data-sv-place')?.split(' ')[0] ??
        undefined)
      : undefined;

  /** The parts lying wholly inside an area of the canvas, keeping only the outermost. */
  function partsInside(within: { left: number; top: number; right: number; bottom: number }) {
    const inside = new Set(
      [...selectable].flatMap(([id, { box }]) => {
        const { left, top, width, height } = onCanvas(box);
        return left >= within.left &&
          left + width <= within.right &&
          top >= within.top &&
          top + height <= within.bottom
          ? [id]
          : [];
      })
    );
    const outermost = (id: string) => {
      for (let up = selectable.get(id)?.parent; up; up = selectable.get(up)?.parent)
        if (inside.has(up)) return false;
      return true;
    };
    return [...inside].filter(outermost);
  }

  /** A position relative to the canvas, which fills the page. */
  function local(event: { clientX: number; clientY: number }): Point {
    const rect = canvas?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    // As Frame.svelte zooms: a mouse wheel notch zooms by 10%, a pinch counts more, and sideways
    // scrolling pans; the point under the pointer stays still.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
    panX -= event.deltaX * unit;
    const rate = event.ctrlKey ? 0.01 : Math.log(1.1) / 100;
    const next = Math.min(Math.max(zoom * Math.exp(-event.deltaY * unit * rate), minZoom), maxZoom);
    const at = local(event);
    const x = at.x - viewport.width / 2;
    const y = at.y - viewport.height / 2;
    panX = x - (x - panX) * (next / zoom);
    panY = y - (y - panY) * (next / zoom);
    zoom = next;
    reportView();
  }

  /** Whether an event's target is in a comment's badge, preview or card, which select nothing. */
  const inNote = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-sv-note]') !== null;

  function onPointerDown(event: PointerEvent) {
    if (inNote(event.target)) return;
    opened = undefined;
    canvas?.focus({ preventScroll: true });
    const pans = event.button === 1 || (event.button === 0 && spaceHeld);
    if (!pans && event.button !== 0) return;
    // The middle button would otherwise start the browser's autoscroll.
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const at = local(event);
    gesture = pans
      ? { kind: 'pan', pointer: event.pointerId, last: at }
      : {
          kind: 'select',
          pointer: event.pointerId,
          start: at,
          at,
          node: partAt(event.target),
          place: placeAt(event.target),
          additive: event.shiftKey || event.ctrlKey || event.metaKey
        };
  }

  function onPointerMove(event: PointerEvent) {
    if (gesture?.pointer !== event.pointerId) return;
    const at = local(event);
    if (gesture.kind === 'pan') {
      panX += at.x - gesture.last.x;
      panY += at.y - gesture.last.y;
      gesture = { ...gesture, last: at };
    } else gesture = { ...gesture, at };
  }

  function onPointerUp(event: PointerEvent) {
    if (gesture?.pointer !== event.pointerId) return;
    const ended = gesture;
    const within = area;
    gesture = undefined;
    if (ended.kind === 'pan') return reportView();
    if (event.type === 'pointercancel') return;
    if (!within)
      onpoint?.({ x: (ended.at.x - corner.x) / shown, y: (ended.at.y - corner.y) / shown });
    if (within) {
      const ids = partsInside(within);
      setSelection(ended.additive ? [...selected, ...ids] : ids);
    } else if (ended.node)
      setSelection(
        ended.additive
          ? selected.includes(ended.node)
            ? selected.filter((id) => id !== ended.node)
            : [...selected, ended.node]
          : [ended.node],
        ended.place ? { node: ended.node, place: ended.place } : undefined
      );
    else if (!ended.additive && selected.length) setSelection([]);
  }

  function onDoubleClick(event: MouseEvent) {
    if (inNote(event.target)) return;
    const part = partAt(event.target);
    // The page is selectable as a whole, but empty space all the same.
    if (part && part !== frame.node?.id) return;
    zoom = 1;
    panX = 0;
    panY = 0;
    reportView();
  }

  function onKey(event: KeyboardEvent) {
    // Space in a comment's text or on its buttons types or presses, rather than panning.
    if (event.key === ' ' && !inNote(event.target)) {
      event.preventDefault();
      spaceHeld = event.type === 'keydown';
    } else if (event.key !== 'Escape' || event.type !== 'keydown') return;
    else if (composing) oncomposecancel?.();
    else if (opened !== undefined) closeCard();
    else if (selected.length) setSelection([]);
  }

  // The places of the reference under the pointer, whose every reference is outlined.
  let hovered = $state<string[]>([]);
  function onPointerOver(event: PointerEvent) {
    const over =
      frame.places && event.target instanceof Element
        ? event.target.closest('[data-sv-place], [data-sv-node]')
        : undefined;
    const own = over?.getAttribute('data-sv-place');
    hovered = own ? own.split(' ') : placesAround(over?.getAttribute('data-sv-node'));
  }
  // Nodes are drawn side by side, not inside their parents, so a pointer's arrow or label finds
  // the place its pointer view refers to by walking up the scene's parents.
  function placesAround(id: string | null | undefined): string[] {
    const byId = new Map(drawn.nodes.map((node) => [node.id, node]));
    for (let node = id ? byId.get(id) : undefined; node; node = byId.get(node.parent ?? ''))
      if (node.places?.length) return node.places;
    return [];
  }
  /** Every reference to a hovered place, on the canvas, in the first shared place's line colour. */
  const hoverOutlines = $derived.by(() => {
    if (!hovered.length || !frame.places) return [];
    const colourOf = (places: readonly string[] | undefined) => {
      const shared = places?.find((place) => hovered.includes(place));
      return shared === undefined
        ? undefined
        : (frame.placeLines?.[shared] ?? frame.places?.[shared] ?? 'currentColor');
    };
    return drawn.nodes.flatMap((node) => {
      const own = colourOf(node.places);
      return [
        ...(own ? [{ box: onCanvas(node.box), colour: own }] : []),
        ...node.runs.flatMap((run) => {
          const colour = colourOf(run.places);
          return colour ? [{ box: onCanvas(run.box), colour }] : [];
        })
      ];
    });
  });

  // Outlines round the selected parts, on the canvas, so they keep their width at any zoom.
  const outlines = $derived(
    selected.flatMap((id) => {
      const node = drawn.byId.get(id);
      const box = node?.box ?? selectable.get(id)?.box;
      return box ? [{ id, ...onCanvas(box) }] : [];
    })
  );

  // The canvas, and the part of the frame showing on it, where comments' cards are kept.
  const canvasBox = $derived({ left: 0, top: 0, width: viewport.width, height: viewport.height });
  const room = $derived(
    overlap(onCanvas({ x: 0, y: 0, width: frame.width, height: frame.height }), canvasBox) ??
      canvasBox
  );
  const toCanvas = (point: Point) => ({
    x: corner.x + point.x * shown,
    y: corner.y + point.y * shown
  });
  /**
   * What a comment is on, on the canvas: an element counts only where the step moved to draws it,
   * its box as it is drawn now, so the badge moves with it.
   */
  const anchorOf = (on: CommentOn) =>
    commentAnchor({ elements: on.elements, point: on.point && toCanvas(on.point) }, (id) => {
      const box = selectable.has(id)
        ? (drawn.byId.get(id)?.box ?? selectable.get(id)?.box)
        : undefined;
      return box && onCanvas(box);
    });

  // Each comment's badge, beside what it is on at this step; none where the step draws none of it.
  const badges = $derived(
    pins.flatMap((pin) => {
      const anchor = anchorOf(pin);
      return anchor ? [{ pin, anchor, at: badgeAt(anchor.box, canvasBox) }] : [];
    })
  );
  const openBadge = $derived(badges.find(({ pin }) => pin.n === opened));
  // The card's size, measured once it shows, guessed until then.
  const cardWidth = 240;
  let cardHeight = $state(96);
  // The open card: a comment written, or the one being written, beside what it is on.
  const card = $derived.by(() => {
    if (!composing && !openBadge) return undefined;
    const anchor = composing ? anchorOf(composing) : openBadge?.anchor;
    const box = anchor?.box ?? {
      left: room.left + room.width / 2,
      top: room.top,
      width: 0,
      height: 0
    };
    return {
      boxes: anchor?.boxes ?? [],
      ...cardPlacement(
        box,
        { width: Math.min(cardWidth, canvasBox.width), height: cardHeight },
        room
      )
    };
  });
  // Faint outlines round the elements of the comment pointed at, in the app or here, or open.
  const noteOutlines = $derived(
    badges
      .filter(({ pin }) => pin.n === pointed || pin.highlighted || pin.n === opened)
      .flatMap(({ anchor }) => anchor.boxes)
      .concat(composing ? (card?.boxes ?? []) : [])
  );
  const previewed = $derived(
    badges.find(({ pin }) => pin.n !== opened && (pin.n === pointed || pin.highlighted))
  );

  function closeCard() {
    const n = opened;
    opened = undefined;
    canvas?.querySelector<HTMLElement>(`[data-sv-badge="${n}"]`)?.focus();
  }
  // The words of the comment being written.
  let draft = $state('');
  function pinDraft() {
    const text = draft.trim();
    if (!text) return;
    oncomment?.(text);
    draft = '';
  }
  const focusOnMount = (node: HTMLElement) => node.focus({ preventScroll: true });

  const dash = (style: string | undefined, width: number) =>
    style === 'dashed'
      ? `${3 * width} ${2 * width}`
      : style === 'dotted'
        ? `0 ${2 * width}`
        : undefined;
  // Text is drawn as the page set it, in its font and case, from the left of the box it filled
  // there on its baseline, its glyphs at their own width and spaced to fill the width the server
  // measured, so a run a browser sets a little wider or narrower is never stretched.
  const cased = (run: SceneText) => (run.case === 'uppercase' ? run.text.toUpperCase() : run.text);
  /**
   * The paint round a node's box, behind it, as its CSS box-shadow draws it (see boxEffects): its
   * glow, a halo grown by its spread and blurred, and its shadow, an offset copy, soft and lifted
   * a blurred black and hard a solid block in its stroke colour or its text's. A CSS blur radius is
   * twice the deviation a blur filter takes. Its place's light, as nodeLight draws it in CSS (see
   * listing/places.ts): a 3px band round its box, a 3px line under it, or a 2px ring 3px off it.
   */
  function effectsOf(node: DrawnNode) {
    const { box, look } = node;
    const radius = look.radius ?? 0;
    const drawn: {
      box: SceneBox;
      radius: number;
      fill: string;
      stroke?: { colour: string; width: number };
      opacity: number;
      blur: number;
    }[] = [];
    const grown = (by: number): SceneBox => ({
      x: box.x - by,
      y: box.y - by,
      width: box.width + 2 * by,
      height: box.height + 2 * by
    });
    if (look.light?.look === 'fill')
      drawn.push({
        box: grown(3),
        radius: radius + 3,
        fill: look.light.colour,
        opacity: 1,
        blur: 0
      });
    else if (look.light?.look === 'underline')
      drawn.push({
        box: { x: box.x + 1, y: box.y + box.height, width: Math.max(box.width - 2, 0), height: 3 },
        radius: 0,
        fill: look.light.colour,
        opacity: 1,
        blur: 0
      });
    else if (look.light?.look === 'outline')
      drawn.push({
        box: grown(4),
        radius: radius + 4,
        fill: 'none',
        stroke: { colour: look.light.colour, width: 2 },
        opacity: 1,
        blur: 0
      });
    if (look.glow) {
      const { spread, blur, alpha } = glowHalo;
      drawn.push({
        box: {
          x: box.x - spread,
          y: box.y - spread,
          width: box.width + 2 * spread,
          height: box.height + 2 * spread
        },
        radius: radius + spread,
        fill: look.glow,
        opacity: alpha,
        blur: blur / 2
      });
    }
    if (look.shadow) {
      const { x, y, blur, alpha } = shadows[look.shadow];
      const hard = look.shadow === 'hard';
      drawn.push({
        box: { ...box, x: box.x + x, y: box.y + y },
        radius,
        fill: hard ? (look.stroke ?? look.color) : '#000000',
        opacity: alpha,
        blur: blur / 2
      });
    }
    return drawn;
  }

  const rect = (node: DrawnNode) =>
    node.look.stroke && node.look.strokeWidth
      ? strokeInside(node.box, node.look.strokeWidth)
      : node.box;

  // The edge is drawn unscaled, just outside the frame, so its dashes keep their size on screen.
  const edgeOffset = 6;
  const edgeWidth = 1;
  const edge = $derived({
    width: frame.width * shown + 2 * edgeOffset,
    height: frame.height * shown + 2 * edgeOffset
  });
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
      x={run.box.x}
      y={run.baseline ?? run.box.y + run.box.height / 2}
      dominant-baseline={run.baseline === undefined ? 'central' : undefined}
      fill={run.color}
      font-family={run.font}
      font-size={run.fontSize}
      font-weight={run.fontWeight}
      font-variant={run.case === 'small-caps' ? 'small-caps' : undefined}
      text-decoration={run.decoration === 'strike' ? 'line-through' : run.decoration}
      textLength={run.box.width > 0 ? run.box.width : undefined}
      lengthAdjust="spacing"
      style:white-space="pre"
      data-sv-place={run.places?.join(' ')}
      opacity={node.opacity}>{cased(run)}</text
    >
  {/each}
{/snippet}

<svelte:window onkeydown={onKey} onkeyup={onKey} onblur={() => (spaceHeld = false)} />

<div
  class="sv-scenes"
  class:panning={gesture?.kind === 'pan'}
  class:pan-ready={spaceHeld}
  bind:this={canvas}
  bind:clientWidth={viewport.width}
  bind:clientHeight={viewport.height}
  role="application"
  tabindex="-1"
  aria-label="Visualization canvas: click or drag to select nodes, scroll to zoom, drag with the middle button or Space held to pan, double-click to reset"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerover={onPointerOver}
  onpointerleave={() => (hovered = [])}
  ondblclick={onDoubleClick}
>
  <svg
    class="sv-scene"
    data-sv-scene="true"
    viewBox="0 0 {frame.width} {frame.height}"
    width={frame.width * shown}
    height={frame.height * shown}
    style:left="{corner.x}px"
    style:top="{corner.y}px"
    role="img"
    aria-label="The visualization at this step"
  >
    <rect
      width={frame.width}
      height={frame.height}
      fill={frame.background}
      data-sv-node={frame.node?.id}
    />
    {#each drawn.nodes as node (node.key)}
      {@const box = rect(node)}
      <g
        data-sv-node={node.leaving ? undefined : node.id}
        data-sv-kind={node.kind}
        data-sv-was={node.was}
        data-sv-place={node.places?.join(' ')}
      >
        {#each effectsOf(node) as effect, i (i)}
          <rect
            x={effect.box.x}
            y={effect.box.y}
            width={effect.box.width}
            height={effect.box.height}
            rx={effect.radius}
            fill={effect.fill}
            stroke={effect.stroke?.colour}
            stroke-width={effect.stroke?.width}
            opacity={node.opacity * effect.opacity}
            style:filter={effect.blur ? `blur(${effect.blur}px)` : undefined}
            pointer-events="none"
          />
        {/each}
        {#if node.look.fill || node.look.stroke}
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={node.look.radius ?? 0}
            data-sv-box
            fill={node.look.fill ?? 'transparent'}
            stroke={node.look.stroke ?? 'none'}
            stroke-width={node.look.strokeWidth ?? 0}
            stroke-dasharray={dash(node.look.strokeStyle, node.look.strokeWidth ?? 1)}
            opacity={node.opacity}
          />
        {:else}
          <!-- Clickable, though it paints nothing. -->
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill="transparent"
            data-sv-box
          />
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
          {#if link.id && link.opacity === 1}
            <!-- A wider stroke to click, as LinkLines.svelte draws it. -->
            <path class="sv-scene-hit" d={link.d} data-sv-node={link.id} />
          {/if}
        </g>
      {/each}
    </g>
    {#each drawn.nodes as node (node.key)}
      {#if node.runs.some((run) => run.overLinks) || node.marks.some((mark) => mark.overLinks)}
        <g data-sv-node={node.leaving ? undefined : node.id}>{@render text(node, true)}</g>
      {/if}
    {/each}
  </svg>
  <svg
    class="sv-scene-edge"
    width={edge.width}
    height={edge.height}
    style:left="{corner.x - edgeOffset}px"
    style:top="{corner.y - edgeOffset}px"
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
  {#each hoverOutlines as outline, i (i)}
    <div
      class="sv-scene-hovered"
      style:left="{outline.box.left}px"
      style:top="{outline.box.top}px"
      style:width="{outline.box.width}px"
      style:height="{outline.box.height}px"
      style:--sv-hover={outline.colour}
    ></div>
  {/each}
  {#each outlines as outline (outline.id)}
    <div
      class="sv-scene-selected"
      style:left="{outline.left}px"
      style:top="{outline.top}px"
      style:width="{outline.width}px"
      style:height="{outline.height}px"
    ></div>
  {/each}
  {#each noteOutlines as outline, i (i)}
    <div
      class="sv-scene-hovered sv-scene-noted"
      style:left="{outline.left}px"
      style:top="{outline.top}px"
      style:width="{outline.width}px"
      style:height="{outline.height}px"
    ></div>
  {/each}
  {#if card}
    <svg class="sv-scene-leader" width={viewport.width} height={viewport.height} aria-hidden="true">
      <line x1={card.from.x} y1={card.from.y} x2={card.to.x} y2={card.to.y} />
    </svg>
  {/if}
  {#each badges as { pin, at } (pin.n)}
    <button
      type="button"
      data-sv-badge={pin.n}
      class={['sv-scene-badge', pin.draft && 'draft', pin.n === opened && 'open']}
      style:left="{at.x}px"
      style:top="{at.y}px"
      data-sv-note
      aria-label="Comment {pin.n}{pin.draft ? ' (not sent yet)' : ''}: {pin.text}"
      aria-expanded={pin.n === opened}
      aria-controls={pin.n === opened ? 'sv-comment-card' : undefined}
      onclick={() => {
        if (pin.n === opened) return closeCard();
        if (composing) oncomposecancel?.();
        opened = pin.n;
      }}
      onpointerenter={() => (pointed = pin.n)}
      onpointerleave={() => (pointed = undefined)}
      onfocus={() => (pointed = pin.n)}
      onblur={() => (pointed = undefined)}
    >
      {pin.n}
    </button>
  {/each}
  {#if previewed}
    <div
      class="sv-scene-preview"
      style:left="{previewed.at.x + badgeSize + 4}px"
      style:top="{previewed.at.y}px"
      data-sv-note
      aria-hidden="true"
    >
      {previewed.pin.text}
    </div>
  {/if}
  {#if card}
    <div
      id="sv-comment-card"
      class="sv-scene-card"
      style:left="{card.left}px"
      style:top="{card.top}px"
      style:width="{Math.min(cardWidth, canvasBox.width)}px"
      bind:offsetHeight={cardHeight}
      data-sv-note
      role="dialog"
      aria-label={composing ? 'New comment' : `Comment ${openBadge?.pin.n}`}
    >
      {#if composing}
        <!-- No form: the sandbox, without allow-forms, never submits one. The app's
          annotationTextMaxLength, which the app checks again. -->
        <textarea
          bind:value={draft}
          maxlength="280"
          rows="3"
          placeholder="Comment on this…"
          aria-label="Comment"
          {@attach focusOnMount}
          onkeydown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              pinDraft();
            }
          }}
        ></textarea>
        <div class="sv-scene-card-actions">
          <button type="button" class="secondary" onclick={() => oncomposecancel?.()}>
            Cancel
          </button>
          <button type="button" disabled={!draft.trim()} onclick={pinDraft}>Pin</button>
        </div>
      {:else if openBadge}
        <div class="sv-scene-card-head">
          <span>Comment {openBadge.pin.n}{openBadge.pin.draft ? ' · not sent yet' : ''}</span>
          <button
            type="button"
            class="sv-scene-card-close"
            aria-label="Close comment {openBadge.pin.n}"
            {@attach focusOnMount}
            onclick={closeCard}>×</button
          >
        </div>
        <p>{openBadge.pin.text}</p>
      {/if}
    </div>
  {/if}
  {#if area}
    <div
      class="sv-scene-box"
      style:left="{area.left}px"
      style:top="{area.top}px"
      style:width="{area.right - area.left}px"
      style:height="{area.bottom - area.top}px"
    ></div>
  {/if}
</div>

<style>
  .sv-scenes {
    position: fixed;
    inset: 0;
    overflow: hidden;
    outline: none;
    /* Dragging selects nodes or pans, so it never selects the text inside. */
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .sv-scenes.pan-ready {
    cursor: grab;
  }
  .sv-scenes.panning {
    cursor: grabbing;
  }
  .sv-scene,
  .sv-scene-edge {
    position: absolute;
    display: block;
  }
  .sv-scene-edge {
    pointer-events: none;
    overflow: visible;
  }
  .sv-scene-edge rect {
    fill: none;
    stroke: var(--sv-muted);
    stroke-opacity: 0.4;
  }
  .sv-scene-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
  }
  .sv-scene-selected,
  .sv-scene-hovered,
  .sv-scene-box {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
  }
  .sv-scene-selected {
    outline: 2px solid var(--sv-select);
    outline-offset: 2px;
    border-radius: 4px;
  }
  /* Every reference to the place hovered, dashed in its colour. */
  .sv-scene-hovered {
    outline: 2px dashed var(--sv-hover);
    outline-offset: 2px;
  }
  .sv-scene-box {
    border: 1px solid var(--sv-select);
    background: color-mix(in srgb, var(--sv-select) 10%, transparent);
  }
  /* The elements of the comment pointed at or open, outlined faintly. */
  .sv-scene-noted {
    --sv-hover: color-mix(in srgb, var(--sv-select) 55%, transparent);
    outline-width: 1.5px;
  }
  /* Comments: the app's card look (shadcn-svelte's), as the page has none of the app's styles. */
  .sv-scene-leader {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .sv-scene-leader line {
    stroke: var(--sv-select);
    stroke-width: 1;
  }
  /* A comment's badge, numbered; a draft, not yet sent, is dashed. */
  .sv-scene-badge {
    position: absolute;
    box-sizing: border-box;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: none;
    border-radius: 8px 8px 8px 2px;
    background: var(--sv-select);
    color: white;
    font:
      600 10px/16px system-ui,
      sans-serif;
    text-align: center;
    box-shadow: 0 1px 2px rgb(0 0 0 / 30%);
    cursor: pointer;
  }
  .sv-scene-badge.draft {
    background: white;
    color: var(--sv-select);
    border: 1.5px dashed var(--sv-select);
    line-height: 13px;
  }
  .sv-scene-badge:focus-visible,
  .sv-scene-card button:focus-visible,
  .sv-scene-card textarea:focus-visible {
    outline: 2px solid var(--sv-select);
    outline-offset: 2px;
  }
  .sv-scene-preview,
  .sv-scene-card {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid #e2e8f0;
    background: white;
    color: #0f172a;
    font:
      12px/1.4 system-ui,
      sans-serif;
    box-shadow: 0 4px 12px rgb(15 23 42 / 12%);
  }
  .sv-scene-preview {
    max-width: 240px;
    padding: 0 6px;
    border-radius: 4px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  .sv-scene-card {
    padding: 8px 10px;
    border-radius: 8px;
    user-select: text;
    -webkit-user-select: text;
    cursor: auto;
  }
  .sv-scene-card p {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .sv-scene-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
    color: #64748b;
    font-weight: 600;
  }
  .sv-scene-card button {
    border: none;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }
  .sv-scene-card .sv-scene-card-close {
    width: 20px;
    height: 20px;
    background: none;
    color: #64748b;
    font-size: 16px;
    line-height: 20px;
  }
  .sv-scene-card .sv-scene-card-close:hover {
    background: #f1f5f9;
    color: #0f172a;
  }
  .sv-scene-card textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font: inherit;
    resize: none;
  }
  .sv-scene-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
  }
  .sv-scene-card-actions button {
    height: 24px;
    padding: 0 8px;
    background: #0f172a;
    color: #f8fafc;
    font-weight: 500;
  }
  .sv-scene-card-actions button.secondary {
    background: #f1f5f9;
    color: #0f172a;
  }
  .sv-scene-card-actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
