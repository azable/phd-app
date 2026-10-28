<!--
  The page around every view: a canvas at a fixed logical size, centred in the page and scaled to
  fit it, that arranges the view's top-level nodes in a column. Its edges are a dashed outline.
  Participants select nodes to reference in feedback: a click selects the node under the pointer,
  Shift, Ctrl, or Cmd adds or removes one, and dragging draws a box. The wheel zooms, dragging with
  the middle button or with Space held pans, and a double click on empty space resets. The view and
  the selection are reported to the app, which restores them when the next step reloads the page.
-->
<script lang="ts">
  import { flushSync, untrack, type Component } from 'svelte';

  import { layoutMemoryContext, provideArrangementParent, provideNodeIds } from './type-context';
  import { alignments, frameRatios, frameWidth, justifications } from './node/scales';
  import type { FrameSettings } from './node/props';
  import { arrangementLayout } from './scene';

  let {
    view: View,
    props,
    settings,
    onsettled,
    onchanged
  }: {
    /** The authored view. */
    view: Component<Record<string, unknown>>;
    /** The view's props: the step's state and the view each type draws. */
    props: Record<string, unknown>;
    settings: FrameSettings;
    /** Called once the layout has stopped changing, so the page can be shown finished. */
    onsettled?: () => void;
    /** Called whenever the layout changes before it settles, so the page can report progress. */
    onchanged?: () => void;
  } = $props();

  provideNodeIds();
  const memory = layoutMemoryContext();

  let frameElement = $state<HTMLDivElement>();
  let rootElement = $state<HTMLDivElement>();
  // An arranged root larger than the frame's inside is scaled down to fit it.
  let rootSize = $state({ width: 0, height: 0 });
  let fit = $state(1);
  // Bumped whenever an arrangement settles, so selection outlines are measured again.
  let layoutRevision = $state(0);
  // The root scales to fill the frame: down when its content is too big, and up, to a limit, when it
  // would leave the frame mostly empty, so every design uses the space it has.
  const largestFit = 1.6;
  // The least size of a CSS root, so once scaled it spans the frame's inside and justify can spread.
  let flowLeast = $state<{ width: number; height: number }>();
  function measureFit() {
    queueMicrotask(fitRoot);
  }
  // Whether the root has been fitted yet: it is, once its size is first observed.
  let fitted = false;
  function fitRoot() {
    const block = rootElement?.querySelector<HTMLElement>(':scope > .sv-root-inner > *');
    if (block && frameElement) {
      fitted = true;
      const style = getComputedStyle(frameElement);
      const inside = {
        width: frameElement.clientWidth - parseFloat(style.paddingLeft) * 2,
        height: frameElement.clientHeight - parseFloat(style.paddingTop) * 2
      };
      // The root is stretched to the frame, so its content's own extent is measured instead.
      const content = flowExtent(block);
      const needed = Math.min(
        largestFit,
        inside.width / Math.max(1, content.width),
        inside.height / Math.max(1, content.height)
      );
      // Every step shows at the smallest fit any step needs, so the view never zooms between them.
      if (memory?.recording) memory.fits.set(memory.step, needed);
      fit = memory && !memory.recording ? Math.min(needed, ...memory.fits.values()) : needed;
      flowLeast = { width: inside.width / fit, height: inside.height / fit };
      rootSize = {
        width: Math.max(content.width, inside.width / fit),
        height: Math.max(content.height, inside.height / fit)
      };
    }
    layoutRevision++;
    if (!settled) onchanged?.();
    scheduleSettle();
  }

  /** The extent of a CSS root's children, laid out in its direction with its gap. */
  function flowExtent(flow: HTMLElement): { width: number; height: number } {
    const children = [...flow.children] as HTMLElement[];
    const gap = (parseFloat(getComputedStyle(flow).rowGap) || 0) * Math.max(0, children.length - 1);
    const widths = children.map((child) => child.offsetWidth);
    const heights = children.map((child) => child.offsetHeight);
    const total = (sizes: number[]) => sizes.reduce((sum, size) => sum + size, 0) + gap;
    return flow.style.flexDirection === 'row'
      ? { width: total(widths), height: Math.max(0, ...heights) }
      : { width: Math.max(0, ...widths), height: total(heights) };
  }
  provideArrangementParent({ changed: measureFit });

  // The layout has settled once two frames pass without another change; a page that cannot paint
  // yet, such as one loaded while hidden, or a pane the browser draws less often, settles after a
  // moment instead. The root's size is observed only as frames are drawn, so a layout settling
  // before it is fitted fits it there, as layout can be read without drawing; shown unfitted, it
  // would jump to its fit, and the step's moves would start from where it was before.
  let settled = false;
  let settleFrame = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSettle() {
    if (settled) return;
    cancelAnimationFrame(settleFrame);
    clearTimeout(settleTimer);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(finishSettling);
    });
    settleTimer = setTimeout(finishSettling, 400);
  }
  function finishSettling() {
    if (settled) return;
    if (!fitted) {
      fitRoot();
      flushSync();
    }
    settled = true;
    cancelAnimationFrame(settleFrame);
    clearTimeout(settleTimer);
    onsettled?.();
  }
  $effect(() => {
    scheduleSettle();
    return () => {
      cancelAnimationFrame(settleFrame);
      clearTimeout(settleTimer);
    };
  });
  // The root block is measured whenever its size changes too: a CSS root has no arrangement to
  // report it, and a page loaded while hidden has no sizes until it is shown.
  $effect(() => {
    const block = rootElement?.querySelector(':scope > .sv-root-inner > *');
    if (!block) return;
    const observer = new ResizeObserver(measureFit);
    observer.observe(block);
    return () => observer.disconnect();
  });
  const width = frameWidth;
  const height = $derived(Math.round(frameWidth / frameRatios[settings.ratio]));

  // The canvas element's own size, observed directly: the window size and its resize events can lag
  // behind the iframe's real size, such as when the app opens a pane, and a stale size would both
  // misfit the frame and move the point zooming keeps still. It starts at the window's size, as
  // the canvas fills the page: the observation arrives a moment after mounting, and a step shown
  // before it would be drawn unscaled, and move from there.
  let canvas = $state<HTMLDivElement>();
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
  // A margin keeps the outline in view at the fitted size.
  const margin = 16;
  const scale = $derived(
    viewport.width > 2 * margin && viewport.height > 2 * margin
      ? Math.min((viewport.width - 2 * margin) / width, (viewport.height - 2 * margin) / height)
      : 1
  );

  const minZoom = 0.25;
  const maxZoom = 8;
  type CanvasView = { zoom: number; panX: number; panY: number };
  const playback = window as {
    __sverlinView?: Partial<CanvasView>;
    __sverlinSelection?: unknown;
  };
  const restored = untrack(() => {
    const saved = playback.__sverlinView;
    return saved && [saved.zoom, saved.panX, saved.panY].every(Number.isFinite)
      ? (saved as CanvasView)
      : { zoom: 1, panX: 0, panY: 0 };
  });
  let zoom = $state(Math.min(Math.max(restored.zoom, minZoom), maxZoom));
  let panX = $state(restored.panX);
  let panY = $state(restored.panY);
  const shown = $derived(scale * zoom);

  const maxSelected = 50;
  const maxLabel = 60;
  // Selected node ids (see provideNodeIds), restored from the app when a step reloads.
  let selected = $state<string[]>(idList(untrack(() => playback.__sverlinSelection)));

  type Point = { x: number; y: number };
  // The pointer gesture in progress: panning, or a press that becomes a click or a selection box.
  let gesture = $state<
    | { kind: 'pan'; pointer: number; last: Point }
    | { kind: 'select'; pointer: number; start: Point; at: Point; node?: string; additive: boolean }
    | undefined
  >();
  let spaceHeld = $state(false);
  // A press only becomes a selection box once it has moved this far, so a click stays a click.
  const dragThreshold = 4;
  const box = $derived(
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

  function idList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, maxSelected)
      : [];
  }

  function post(message: Record<string, unknown>) {
    if (window.parent !== window) window.parent.postMessage(message, '*');
  }

  function reportView() {
    // Kept on the page too, so the next step, mounted in place, starts from the same view.
    playback.__sverlinView = { zoom, panX, panY };
    post({ type: 'sverlin:view', zoom, panX, panY });
  }

  /**
   * The constraint layouts around a selected node: the one placing it among its siblings, and the
   * one placing its own children, if any. Each names the node it belongs to and the seed it drew
   * from, so feedback such as "keep this layout" can pin that seed.
   */
  function layoutsOf(element: HTMLElement) {
    const own = element.querySelector<HTMLElement>(':scope > .sv-arranged');
    const placing = element.parentElement?.closest<HTMLElement>('.sv-arranged');
    return [own, placing].flatMap((arranged) => (arranged && arrangementLayout(arranged)) || []);
  }

  // A selection is reported with a short label for each node: its type, if any, and its text.
  function reportSelection() {
    const elements = selected.flatMap((id) => {
      const element = nodeElement(id);
      if (!element) return [];
      // innerText follows layout, so text in separate boxes stays separate words.
      const text = (element.innerText || element.textContent || '').replace(/\s+/gu, ' ').trim();
      // A link has no text of its own, so it brings a label: its own, or the keys it joins.
      const typed =
        element.dataset.svLabel ??
        ([element.dataset.svType, text].filter(Boolean).join(' ') || 'node');
      const label = typed.length > maxLabel ? `${typed.slice(0, maxLabel - 1)}…` : typed;
      return [
        {
          id,
          label,
          layouts: layoutsOf(element)
        }
      ];
    });
    post({ type: 'sverlin:selection', elements });
  }

  function nodeElement(id: string): HTMLElement | undefined {
    return canvas?.querySelector<HTMLElement>(`[data-sv-node="${CSS.escape(id)}"]`) ?? undefined;
  }

  /** The innermost node at an event's target, if any. */
  function nodeAt(target: EventTarget | null): string | undefined {
    return target instanceof Element
      ? (target.closest<HTMLElement>('[data-sv-node]')?.dataset.svNode ?? undefined)
      : undefined;
  }

  /** Nodes lying wholly inside a box in page coordinates, keeping only the outermost. */
  function nodesInside(area: { left: number; top: number; right: number; bottom: number }) {
    const inside = new Set(
      [...(canvas?.querySelectorAll<HTMLElement>('[data-sv-node]') ?? [])].filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= area.left &&
          rect.right <= area.right &&
          rect.top >= area.top &&
          rect.bottom <= area.bottom
        );
      })
    );
    return [...inside]
      .filter((element) => {
        for (
          let parent = element.parentElement?.closest<HTMLElement>('[data-sv-node]');
          parent;
          parent = parent.parentElement?.closest<HTMLElement>('[data-sv-node]')
        )
          if (inside.has(parent)) return false;
        return true;
      })
      .map((element) => element.dataset.svNode as string);
  }

  function setSelection(ids: string[]) {
    selected = [...new Set(ids)].slice(0, maxSelected);
    reportSelection();
  }

  /** A position relative to the canvas, which fills the page. */
  function local(event: { clientX: number; clientY: number }): Point {
    const rect = canvas?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    // Deltas in lines or pages become pixels, so every device zooms by the distance it scrolls: a
    // mouse wheel notch (about 100 pixels) zooms by 10%, and a trackpad's many small events add up
    // smoothly. A pinch arrives as a wheel event with ctrlKey and small deltas, so it counts more.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
    // Sideways scrolling, as on a trackpad, pans instead.
    panX -= event.deltaX * unit;
    const rate = event.ctrlKey ? 0.01 : Math.log(1.1) / 100;
    const next = Math.min(Math.max(zoom * Math.exp(-event.deltaY * unit * rate), minZoom), maxZoom);
    // Keep the point under the pointer still. The frame's centre sits at the canvas centre plus the
    // pan, so positions are taken relative to the canvas centre, measured now.
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    panX = x - (x - panX) * (next / zoom);
    panY = y - (y - panY) * (next / zoom);
    zoom = next;
    reportView();
  }

  function onPointerDown(event: PointerEvent) {
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
          node: nodeAt(event.target),
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
    const area = box;
    gesture = undefined;
    if (ended.kind === 'pan') {
      reportView();
      return;
    }
    if (event.type === 'pointercancel') return;
    if (area) {
      const rect = canvas?.getBoundingClientRect();
      const offset = { x: rect?.left ?? 0, y: rect?.top ?? 0 };
      const ids = nodesInside({
        left: area.left + offset.x,
        right: area.right + offset.x,
        top: area.top + offset.y,
        bottom: area.bottom + offset.y
      });
      setSelection(ended.additive ? [...selected, ...ids] : ids);
    } else if (ended.node)
      setSelection(
        ended.additive
          ? selected.includes(ended.node)
            ? selected.filter((id) => id !== ended.node)
            : [...selected, ended.node]
          : [ended.node]
      );
    else if (!ended.additive && selected.length) setSelection([]);
  }

  function onDoubleClick(event: MouseEvent) {
    if (nodeAt(event.target)) return;
    zoom = 1;
    panX = 0;
    panY = 0;
    reportView();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === ' ') {
      event.preventDefault();
      spaceHeld = event.type === 'keydown';
    } else if (event.key === 'Escape' && event.type === 'keydown' && selected.length)
      setSelection([]);
  }

  // The app shows a selection, such as when a participant opens a reference from the timeline.
  $effect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: unknown; ids?: unknown };
      if (data?.type === 'sverlin:select') selected = idList(data.ids);
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  });

  // Outlines around selected nodes. Each node is measured once laid out, in the frame's own unscaled
  // coordinates, then placed on screen from the current zoom and pan, so outlines move in step with
  // the frame and keep their width at any zoom.
  type Box = { id: string; left: number; top: number; width: number; height: number };
  let measured = $state<Box[]>([]);
  $effect(() => {
    const ids = [...selected];
    void [viewport.width, viewport.height, layoutRevision];
    const frame = requestAnimationFrame(() => {
      const element = canvas?.querySelector<HTMLElement>('.sv-frame');
      const origin = element?.getBoundingClientRect();
      // The frame's real scale, read from the page with its position.
      const ratio = origin && origin.width ? width / origin.width : 1;
      measured = ids.flatMap((id) => {
        const rect = nodeElement(id)?.getBoundingClientRect();
        return rect && origin
          ? [
              {
                id,
                left: (rect.left - origin.left) * ratio,
                top: (rect.top - origin.top) * ratio,
                width: rect.width * ratio,
                height: rect.height * ratio
              }
            ]
          : [];
      });
    });
    return () => cancelAnimationFrame(frame);
  });
  const outlines = $derived.by(() => {
    const left = viewport.width / 2 + panX - (width * shown) / 2;
    const top = viewport.height / 2 + panY - (height * shown) / 2;
    return measured.map((box) => ({
      id: box.id,
      left: left + box.left * shown,
      top: top + box.top * shown,
      width: box.width * shown,
      height: box.height * shown
    }));
  });

  // The outline is drawn unscaled, just outside the frame, so its dashes keep their size on screen.
  const edgeOffset = 6;
  const edgeWidth = 1;
  const edge = $derived({
    width: width * shown + 2 * edgeOffset,
    height: height * shown + 2 * edgeOffset
  });
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} onblur={() => (spaceHeld = false)} />

<div
  bind:this={canvas}
  class="sv-viewport"
  bind:clientWidth={viewport.width}
  bind:clientHeight={viewport.height}
  class:panning={gesture?.kind === 'pan'}
  class:pan-ready={spaceHeld}
  role="application"
  tabindex="-1"
  aria-label="Visualization canvas: click or drag to select nodes, scroll to zoom, drag with the middle button or Space held to pan, double-click to reset"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  ondblclick={onDoubleClick}
>
  <div
    bind:this={frameElement}
    class="sv-frame"
    style:width="{width}px"
    style:height="{height}px"
    style:transform="translate(-50%, -50%) translate({panX}px, {panY}px) scale({shown})"
    style:padding={`${settings.padding}em`}
    style:justify-content={justifications[settings.justify]}
    style:align-items={alignments[settings.align]}
  >
    <div
      class="sv-root"
      bind:this={rootElement}
      style:width="{rootSize.width * fit}px"
      style:height="{rootSize.height * fit}px"
    >
      <div class="sv-root-inner" style:transform="scale({fit})">
        <!-- At least the frame's inside, so justify and align spread what fits. -->
        <div
          class="sv-flow"
          style:flex-direction={settings.layout}
          style:gap={`${settings.gap}em`}
          style:justify-content={justifications[settings.justify]}
          style:align-items={alignments[settings.align]}
          style:min-width={flowLeast
            ? `${flowLeast.width}px`
            : `calc(${width}px - 2 * ${settings.padding}em)`}
          style:min-height={flowLeast
            ? `${flowLeast.height}px`
            : `calc(${height}px - 2 * ${settings.padding}em)`}
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
    style:transform="translate(-50%, -50%) translate({panX}px, {panY}px)"
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
  {#each outlines as outline (outline.id)}
    <div
      class="sv-selected"
      style:left="{outline.left}px"
      style:top="{outline.top}px"
      style:width="{outline.width}px"
      style:height="{outline.height}px"
    ></div>
  {/each}
  {#if box}
    <div
      class="sv-box"
      style:left="{box.left}px"
      style:top="{box.top}px"
      style:width="{box.right - box.left}px"
      style:height="{box.bottom - box.top}px"
    ></div>
  {/if}
</div>

<style>
  .sv-viewport {
    position: fixed;
    inset: 0;
    overflow: hidden;
    outline: none;
    /* Dragging selects nodes or pans, so it never selects the text inside. */
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .sv-viewport.pan-ready {
    cursor: grab;
  }
  .sv-viewport.panning {
    cursor: grabbing;
  }
  /* Both are centred on the page by their own size, then panned; only the frame is scaled. */
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
  .sv-selected,
  .sv-box {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
  }
  .sv-selected {
    outline: 2px solid var(--sv-select);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .sv-box {
    border: 1px solid var(--sv-select);
    background: color-mix(in srgb, var(--sv-select) 10%, transparent);
  }
</style>
