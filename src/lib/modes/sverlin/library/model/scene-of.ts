/**
 * A step's scene (see ../scene.ts) worked out on the layout model from the markup of the state it
 * shows, as the page's describeStep reads it from a mounted layer, so a scene needs no browser:
 * every node's box and look, its text in lines, its listing marks and its drawings' shapes, and
 * every link, a free layout's as the server routes it (see routesOf in reserve.ts) and a row's,
 * column's or grid's as LinkOverlay routes it, with their labels. The root is drawn at the frame's
 * fit, as Frame.svelte draws it: placed at the frame's padding, its least size the frame's inside.
 */

import {
  arrangeChildren,
  followerReach,
  rowOf,
  shownIn,
  type ArrangementProps
} from '../node/arrangement';
import { lineColour } from '../listing/places';
import { shadows, type Shadow } from '../node/design';
import { headDrawing, headTrim } from '../node/heads';
import type { Line, LineStyle } from '../node/LinkLines.svelte';
import { markerLook } from '../node/markers';
import { routeOverlay } from '../node/overlay';
import type { Layout } from '../node/props';
import {
  readingText,
  sceneLink,
  type SceneBox,
  type SceneFrame,
  type SceneLink,
  type SceneLook,
  type SceneMark,
  type SceneNode,
  type SceneStep,
  type SceneText
} from '../scene';
import { fontOf, type ModelLayout } from './layout';
import { substitutedOrNone, type Styled } from './look';
import { sizerFor, type ReserveOptions } from './reserve';
import { svgShapes } from './svg-shapes';
import { caseOf } from './text-case';
import { classesOf, isElement, type ModelElement } from './tree';

/** The frame every step shows in, and the fit its root is drawn at (see shownFrame in ../fit.ts). */
export type SceneFrameSize = { width: number; height: number; fit: number };

const round = (value: number) => Math.round(value * 100) / 100;
const layouts: readonly string[] = ['row', 'column', 'grid', 'free', 'stack'] satisfies Layout[];
const elementsOf = (element: ModelElement) => element.children.filter(isElement);
const transparent = (colour: string | undefined) =>
  !colour ||
  ['transparent', 'none'].includes(colour) ||
  /^rgba\(.*,\s*0\)$/u.test(colour) ||
  /\/\s*0\)$/u.test(colour);

/**
 * A node's place light, written as data-sv-light="look|colour" (see Node.svelte), as its CSS
 * box-shadow or outline, which the scene does not read, would be lost.
 */
function lightOfNode(written: string | undefined): Pick<SceneLook, 'light'> {
  const split = written?.indexOf('|') ?? -1;
  if (!written || split < 0) return {};
  const look = written.slice(0, split);
  if (look !== 'fill' && look !== 'underline' && look !== 'outline') return {};
  return { light: { look, colour: written.slice(split + 1) } };
}

/** A node round what is walked; described, unless it is hidden. */
type Open = { element: ModelElement; node?: SceneNode };

/** Where an element is placed, in the root's pixels before the frame's fit. */
type PlacedBox = { left: number; top: number; width: number; height: number };

/** A link from a variable (data-sv-reach), with the box of the node it starts at. */
type Reaching = { marker: ModelElement; from: PlacedBox; hidden: boolean };

/** Where a walk is: the layout its boxes come from and that layout's root, in the root's pixels. */
type Place = { layout: ModelLayout; x: number; y: number };

type Context = Place & {
  /** The nearest node, which text is drawn by, and the nodes round it. */
  open: Open[];
  /** Whether the nearest data-sv-hidden says hidden, as the page's scene decides what is seen. */
  hidden: boolean;
  /** In a link's label, drawn over the links. */
  label: boolean;
  /** Inside the part asked for, whose nodes and links are described. */
  inPart: boolean;
  /** The places the nearest listing token round the text names (see listing/places.ts). */
  places?: string[];
};

/**
 * What of the steps to describe: some steps only, by number, and one part of each, the nodes with
 * an id (data-sv-node) or of a kind (data-sv-kind, as 'Graph' or 'VertexCard'), with everything
 * inside them and the links they draw; unset, all of it. Boxes stay where the whole step puts them.
 */
export type SceneRequest = { steps?: readonly number[]; part?: { node?: string; kind?: string } };

/**
 * Every step's scene, from the state each shows (its second, as the page shows a step), each state
 * described once for every step showing it, and the frame's; none where the model cannot lay a
 * state out, for the page to describe instead. A state the view failed to draw is a step drawn
 * as an error, as the page draws it. Asked for some steps, the others are left out.
 */
export function scenesOf(
  shown: ReadonlyMap<number, ModelElement | undefined>,
  drawnLike: readonly number[],
  stepCount: number,
  options: ReserveOptions,
  frame: SceneFrameSize & Pick<SceneFrame, 'places'> & { lines?: Record<string, string> },
  request: SceneRequest = {}
): { frame: SceneFrame; steps: SceneStep[] } | undefined {
  const described = new Map<number, SceneStep>();
  const steps: SceneStep[] = [];
  let background: string | undefined;
  let page: SceneFrame['node'];
  for (let step = 0; step < stepCount; step++) {
    if (request.steps && !request.steps.includes(step)) continue;
    const state = drawnLike[2 * step + 1];
    let scene = described.get(state);
    if (!scene) {
      const markup = shown.get(state);
      if (!markup) scene = { nodes: [], links: [], error: 'This step could not be drawn.' };
      else
        try {
          const memory = { ...options.memory, step: state };
          const laid = sceneOf(markup, { ...options, memory }, frame, request.part);
          scene = laid.scene;
          background ??= laid.background;
          page ??= laid.page;
        } catch {
          return undefined;
        }
      described.set(state, scene);
    }
    steps.push(scene);
  }
  const shownBackground = background ?? '#ffffff';
  const placeLines = Object.fromEntries(
    Object.entries(frame.lines ?? {}).flatMap(([place, paint]) => {
      const css = lineColour(paint, shownBackground);
      return css ? [[place, css]] : [];
    })
  );
  return {
    frame: {
      width: frame.width,
      height: frame.height,
      background: shownBackground,
      ...(page ? { node: page } : {}),
      ...(frame.places && Object.keys(frame.places).length ? { places: frame.places } : {}),
      ...(Object.keys(placeLines).length ? { placeLines } : {})
    },
    steps
  };
}

/** One step's scene from the markup of the state it shows, or one part of it. */
export function sceneOf(
  markup: ModelElement,
  options: ReserveOptions,
  frame: SceneFrameSize,
  part?: SceneRequest['part']
): { scene: SceneStep; background?: string; page?: SceneFrame['node'] } {
  const isPart = ({ attributes }: ModelElement) =>
    attributes['data-sv-node'] !== undefined &&
    ((part?.node !== undefined && attributes['data-sv-node'] === part.node) ||
      (part?.kind !== undefined && attributes['data-sv-kind'] === part.kind));
  // Each free layout is routed here, from the markup as drawn (see routesOf).
  const reserve = { ...options, memory: { ...options.memory, routes: undefined } };
  const model = sizerFor(reserve);
  const first = model.read({ markup });
  if (!first) return { scene: { nodes: [], links: [] } };
  const [padTop, padRight, padBottom, padLeft] = first.styled.get(first.frame)?.look.padding ?? [
    0, 0, 0, 0
  ];
  const { fit } = frame;
  // The root's least size, so once scaled it spans the frame's inside (flowLeast in Frame.svelte).
  const least = {
    width: (frame.width - padLeft - padRight) / fit,
    height: (frame.height - padTop - padBottom) / fit
  };
  const reading = model.read({
    markup: replaced(markup, first.flow, {
      ...first.flow,
      style: {
        ...first.flow.style,
        'min-width': `${least.width}px`,
        'min-height': `${least.height}px`
      }
    })
  });
  if (!reading) return { scene: { nodes: [], links: [] } };
  const at = reading;
  const toX = (x: number) => round(padLeft + x * fit);
  const toY = (y: number) => round(padTop + y * fit);
  const sceneBox = (x: number, y: number, width: number, height: number): SceneBox => ({
    x: toX(x),
    y: toY(y),
    width: round(width * fit),
    height: round(height * fit)
  });
  const styledOf = (element: ModelElement) => at.styled.get(element) as Styled;
  const nodes: SceneNode[] = [];
  const links: SceneLink[] = [];
  const frameRef = at.frame.attributes['data-sv-node'];
  // For links from variables (see linksFromVariables): where each element is placed, the
  // outermost node drawing each element of the state, the node each element is described as, the
  // links from variables met on the way, and those a free layout laid out as its own.
  const placedBoxes = new Map<ModelElement, PlacedBox>();
  const slotted = new Map<string, PlacedBox & { element: ModelElement }>();
  // The node an {#each} draws each item in, by its element, for an element no node inside draws as
  // a value, as a bar whose height is the value: a link from a variable reaches that node.
  const items = new Map<string, PlacedBox & { element: ModelElement }>();
  const elementAt = (slot: string) => slotted.get(slot) ?? items.get(slot);
  const described = new Map<ModelElement, SceneNode>();
  const reaching: Reaching[] = [];
  const laidOut = new Set<string>();
  // The link of each follower, with the child its variable's element is in: its arrow ends just
  // under all that child draws, as a vertex's caption, so it crosses none of it.
  const following = new Map<ModelElement, { left: number; right: number; bottom: number }>();

  const linkOf = (
    line: Line,
    style: LineStyle | undefined,
    host: ModelElement,
    x: number,
    y: number
  ) => {
    // A link drawn by no <Link>, as a relation's, is a fine muted line (see LinkLines.svelte).
    if (style?.shown === false) return;
    const width = Number(style?.strokeWidth);
    const pixels = Number.isFinite(width) && style?.strokeWidth ? width : 2;
    const stroke =
      substitutedOrNone(style?.stroke ?? 'var(--sv-muted)', styledOf(host).inherited.custom) ??
      '#000000';
    const head = headDrawing(line.head?.shape) ? line.head : undefined;
    const link = sceneLink({
      d: line.path,
      link: line.link,
      id: line.id,
      at: (px, py) => ({ x: toX(x + px), y: toY(y + py) }),
      head: head?.shape,
      headSize: (head?.size ?? NaN) * fit,
      start: !!head && line.heads.start,
      end: !!head && line.heads.end,
      strokeStyle: style?.strokeStyle,
      stroke,
      strokeWidth: round(pixels * fit)
    });
    if (link) links.push(link);
  };

  /** A placed label: its box centred on the middle of its link, in its own layout. */
  const walkLabel = (
    label: ModelElement,
    layout: ModelLayout,
    middle: { x: number; y: number },
    context: Context
  ) => {
    const box = layout.boxes.get(label);
    if (!box) return;
    // offsetWidth and offsetHeight, as placeLabels centres it, are whole pixels.
    const left = middle.x - Math.round(box.width) / 2;
    const top = middle.y - Math.round(box.height) / 2;
    walk(label, { ...context, layout, x: left - box.x, y: top - box.y, label: true }, true);
  };

  function walk(element: ModelElement, context: Context, placedLabel = false) {
    const { attributes } = element;
    if (attributes['data-sv-link'] !== undefined) {
      const source = context.open.at(-1)?.element;
      const from = source && placedBoxes.get(source);
      if (attributes['data-sv-reach'] === 'true' && from && context.inPart)
        reaching.push({ marker: element, from, hidden: context.hidden });
      return;
    }
    if (attributes['data-sv-link-label'] !== undefined && !placedLabel) return;
    const styled = styledOf(element);
    if (!styled || styled.look.display === 'none') return;
    const box = context.layout.boxes.get(element) ?? { x: 0, y: 0, width: 0, height: 0 };
    const left = context.x + box.x;
    const top = context.y + box.y;
    const hidden =
      attributes['data-sv-hidden'] === undefined
        ? context.hidden
        : attributes['data-sv-hidden'] === 'true';
    const owner = context.open.at(-1);
    const placed: PlacedBox = { left, top, width: box.width, height: box.height };
    placedBoxes.set(element, placed);
    const slot = attributes['data-sv-slot'];
    if (slot && !hidden && !slotted.has(slot)) slotted.set(slot, { element, ...placed });
    const item = attributes['data-sv-item'];
    if (item && !hidden && !items.has(item)) items.set(item, { element, ...placed });
    if (element.tag === 'svg') {
      if (owner?.node && !hidden) {
        const shapes = svgShapes(
          element,
          [fit, 0, 0, fit, toX(left), toY(top)],
          box.width,
          box.height,
          styled.paint.color
        );
        if (shapes.length) (owner.node.shapes ??= []).push(...shapes);
      }
      return;
    }
    let open = context.open;
    const inPart = context.inPart || isPart(element);
    const isNode = element.tag === 'div' && attributes['data-sv-node'] !== undefined;
    if (isNode) {
      const node =
        attributes['data-sv-hidden'] === 'true'
          ? undefined
          : describeNode(element, styled, sceneBox(left, top, box.width, box.height), open);
      if (node) {
        if (inPart) nodes.push(node);
        described.set(element, node);
        const text = readingText(ownPieces(element, element, context.hidden));
        if (text) node.text = text;
      }
      open = [...open, { element, ...(node ? { node } : {}) }];
    }
    const nearest = open.at(-1);
    if (nearest?.node && !isNode && !hidden) {
      const mark = markOf(element, styled, sceneBox(left, top, box.width, box.height), placedLabel);
      if (mark) (nearest.node.marks ??= []).push(mark);
    }
    const places = isNode
      ? undefined
      : attributes['data-sv-place'] !== undefined
        ? attributes['data-sv-place'].split(' ')
        : context.places;
    const next: Context = { ...context, open, hidden, inPart, places };
    const drawsLinks = inPart && !hidden;
    // Its children and its text in order, the text drawn in lines by the nearest node.
    const texts = new Map(
      (context.layout.texts.get(element) ?? []).map((text) => [text.index, text])
    );
    const walkChildren = () =>
      element.children.forEach((child, index) => {
        if (isElement(child)) return walk(child, next);
        const text = texts.get(index);
        if (text && nearest?.node && !hidden) {
          const { x, y, width, height } = text.box;
          (nearest.node.runs ??= []).push(
            runOf(
              styled,
              text.text,
              sceneBox(context.x + x, context.y + y, width, height),
              nearest.element,
              context.label,
              places
            )
          );
        }
      });
    if (attributes['data-sv-overlaid'] !== undefined) {
      const classes = classesOf(element);
      const axis = classes.includes('sv-grid')
        ? 'grid'
        : classes.includes('row')
          ? 'row'
          : 'column';
      const route = routeOverlay(model.layoutReader(at, context.layout), element, axis);
      if (drawsLinks) for (const line of route.lines) linkOf(line, line.style, element, left, top);
      walkChildren();
      for (const { label, middle } of route.labels)
        walkLabel(label, context.layout, { x: left + middle.x, y: top + middle.y }, next);
      return;
    }
    const host = classesOf(element).includes('sv-arranged')
      ? elementsOf(element).find((child) => classesOf(child).includes('placed'))
      : undefined;
    if (!host) {
      walkChildren();
      return;
    }
    // Placed as Arranged.svelte places them: each child laid out on its own at its place.
    const props = JSON.parse(attributes['data-sv-arrange'] ?? '{}') as ArrangementProps;
    const arranged = arrangeChildren(model.hostReader(at, host), host, props, reserve.memory);
    const arranging = open.at(-1)?.node;
    const seed = Number(attributes['data-sv-layout-seed']);
    if (arranging && attributes['data-sv-layout-seed'] !== undefined && Number.isFinite(seed)) {
      const kind = attributes['data-sv-layout-kind'];
      const { form, direction, curve } = arranged.choices;
      arranging.arrangement = {
        ...(kind ? { kind } : {}),
        seed,
        ...(form ? { form } : {}),
        ...(direction ? { direction } : {}),
        ...(curve ? { curve } : {})
      };
    }
    arranged.elements.forEach((child, index) => {
      const layout = model.layOutAlone(at, child, true);
      const own = layout.boxes.get(child) ?? { x: 0, y: 0 };
      const { x, y } = arranged.placements[index];
      walk(child, { ...next, layout, x: left + x - own.x, y: top + y - own.y });
    });
    // A child drawing a variable whose link reaches an element of this layout goes under the whole
    // child the element is in, below all it draws there, as a vertex's caption, so its arrow
    // crosses none of it; followers under one child at a step go side by side, centred on the
    // element, in the room the layout kept there (see followers in arrangement.ts). One reaching
    // nothing waits in the row under the layout, drawing what its variable holds (see withRest).
    const gap = (props.gap ?? 0) * (styledOf(host)?.look.fontSize || 16);
    const reach = followerReach(gap);
    const placing = arranged.followers.map((follower) => {
      const marker = [...descendants(follower)].find(
        (inner) => inner.attributes['data-sv-reach'] === 'true'
      );
      const target = elementAt(marker?.attributes['data-to'] ?? '');
      const child =
        target &&
        arranged.elements.find(
          (each) => each === target.element || [...descendants(each)].includes(target.element)
        );
      const layout = model.layOutAlone(at, follower, true);
      const own = layout.boxes.get(follower) ?? { x: 0, y: 0, width: 0, height: 0 };
      const under: PlacedBox | undefined = (child && placedBoxes.get(child)) || target;
      return { follower, marker, target, under, layout, own };
    });
    const groups = new Map<PlacedBox, typeof placing>();
    for (const each of placing)
      if (each.under) groups.set(each.under, [...(groups.get(each.under) ?? []), each]);
    for (const [under, group] of groups) {
      const target = group[0].target as PlacedBox;
      const row = rowOf(
        group.map(({ own }) => own),
        gap
      );
      let x = target.left + target.width / 2 - row.width / 2;
      const top = under.top + under.height + reach;
      for (const { follower, marker, layout, own } of group) {
        walk(follower, { ...next, layout, x: x - own.x, y: top - own.y });
        const drawnAs = described.get(follower);
        if (drawnAs) drawnAs.follows = marker?.attributes['data-to'];
        if (marker)
          following.set(marker, {
            left: under.left,
            right: under.left + under.width,
            bottom: under.top + under.height
          });
        x += own.width + gap;
      }
    }
    if (arranged.rest) {
      let x = left + arranged.rest.x;
      for (const { follower, target, layout, own } of placing) {
        if (target || !shownIn(model.hostReader(at, host), follower)) continue;
        walk(follower, { ...next, layout, x: x - own.x, y: top + arranged.rest.y - own.y });
        x += own.width + gap;
      }
    }
    for (const edge of arranged.edges) {
      if (edge.id !== undefined) laidOut.add(edge.id);
      if (drawsLinks)
        linkOf(
          edge,
          edge.id === undefined ? undefined : arranged.styles[edge.id],
          element,
          left,
          top
        );
      const label = edge.id === undefined ? undefined : arranged.labels.get(edge.id);
      if (label)
        walkLabel(
          label,
          model.layOutAlone(at, label, true),
          { x: left + edge.middle.x, y: top + edge.middle.y },
          next
        );
    }
  }

  function describeNode(
    element: ModelElement,
    styled: Styled,
    box: SceneBox,
    open: Open[]
  ): SceneNode {
    const { attributes } = element;
    const { look, paint } = styled;
    const strokeWidth = round(look.border[0] * fit);
    const stroke = strokeWidth && !transparent(paint.borderColor) ? paint.borderColor : undefined;
    const radius = Math.min(round(paint.radius * fit), box.width / 2, box.height / 2);
    const padding = look.padding.map((side) => round(side * fit)) as [
      number,
      number,
      number,
      number
    ];
    const shown = elementsOf(element).find((child) => classesOf(child).includes('value'));
    const unitElement =
      shown && [...descendants(shown)].find((inner) => classesOf(inner).includes('unit'));
    const unit = unitElement ? textOf(unitElement) : undefined;
    const firstChild = shown?.children[0];
    const value = shown
      ? firstChild === undefined
        ? ''
        : typeof firstChild === 'string'
          ? firstChild
          : textOf(firstChild)
      : undefined;
    const colours = Object.fromEntries(
      (['fill', 'stroke', 'color'] as const).flatMap((use) => {
        const name = attributes[`data-sv-${use}`];
        return name && name !== 'none' ? [[use, name]] : [];
      })
    ) as SceneNode['colours'];
    const id = attributes['data-sv-node'] ?? '';
    const enclosing = open.at(-1)?.element.attributes['data-sv-node'] ?? frameRef;
    const parent = enclosing === id ? undefined : enclosing;
    const shadow = attributes['data-sv-shadow'];
    return {
      id,
      ...(parent ? { parent } : {}),
      ...(attributes['data-sv-type'] ? { type: attributes['data-sv-type'] } : {}),
      ...(attributes['data-sv-kind'] ? { kind: attributes['data-sv-kind'] } : {}),
      ...(layouts.includes(attributes['data-sv-layout'] ?? '')
        ? { layout: attributes['data-sv-layout'] as Layout }
        : {}),
      ...(elementsOf(element).some((child) => child.attributes['data-sv-collection'] !== undefined)
        ? { collection: true as const }
        : {}),
      ...(value === undefined ? {} : { value }),
      ...(unit ? { unit } : {}),
      box,
      look: {
        ...(transparent(paint.background) ? {} : { fill: paint.background }),
        ...(stroke
          ? {
              stroke,
              strokeWidth,
              ...(paint.borderStyle === 'dashed' || paint.borderStyle === 'dotted'
                ? { strokeStyle: paint.borderStyle }
                : {})
            }
          : {}),
        ...(radius ? { radius: round(radius) } : {}),
        ...(padding.some(Boolean) ? { padding } : {}),
        color: paint.color,
        font: look.fontFamily,
        fontSize: round(look.fontSize * fit),
        fontWeight: Number(look.fontWeight) || 400,
        ...(paint.opacity < 1 ? { opacity: paint.opacity } : {}),
        ...(shadow && Object.hasOwn(shadows, shadow) ? { shadow: shadow as Shadow } : {}),
        ...(attributes['data-sv-glow']
          ? { glow: stroke ?? paint.background ?? 'rgba(0, 0, 0, 0)' }
          : {}),
        ...(attributes['data-sv-fill-style'] === 'hatched'
          ? { fillStyle: 'hatched' as const }
          : {}),
        ...lightOfNode(attributes['data-sv-light'])
      },
      ...(colours && Object.keys(colours).length ? { colours } : {}),
      ...(attributes['data-sv-place'] ? { places: attributes['data-sv-place'].split(' ') } : {}),
      ...(attributes['data-sv-identity'] ? { identity: attributes['data-sv-identity'] } : {})
    };
  }

  function runOf(
    styled: Styled,
    text: string,
    box: SceneBox,
    node: ModelElement,
    overLinks: boolean,
    places: string[] | undefined
  ): SceneText {
    const { look, paint } = styled;
    const marked = node.attributes['data-sv-decoration'];
    const textCase = caseOf(look.textTransform, look.fontVariantCaps);
    return {
      text,
      box,
      color: paint.color,
      font: look.fontFamily,
      fontSize: round(look.fontSize * fit),
      fontWeight: Number(look.fontWeight) || 400,
      ...(marked === 'underline' || marked === 'strike' ? { decoration: marked } : {}),
      ...(textCase ? { case: textCase } : {}),
      ...(overLinks ? { overLinks: true as const } : {}),
      ...(places?.length ? { places } : {}),
      // Rounded to whole pixels, as lines take the ascent (see metricsOf in layout.ts).
      baseline: round(box.y + Math.round(options.measure.metrics(fontOf(look)).ascent) * fit)
    };
  }

  /** The paint behind a listing's lit code or a place, or a placed label's background. */
  function markOf(
    element: ModelElement,
    styled: Styled,
    box: SceneBox,
    placedLabel: boolean
  ): SceneMark | undefined {
    const { attributes } = element;
    const label = placedLabel && attributes['data-sv-link-label'] !== undefined;
    if (
      attributes['data-sv-lit'] === undefined &&
      attributes['data-sv-place'] === undefined &&
      !label
    )
      return undefined;
    const { paint } = styled;
    const fill = transparent(paint.background) ? undefined : paint.background;
    const outline = paint.outline && !transparent(paint.outline.color) ? paint.outline : undefined;
    if ((!fill && !outline) || !box.width || !box.height) return undefined;
    const radius = round(paint.radius * fit);
    return {
      box,
      ...(fill ? { fill } : {}),
      ...(outline
        ? {
            stroke: outline.color,
            strokeWidth: round(outline.width * fit),
            ...(outline.style === 'dashed' || outline.style === 'dotted'
              ? { strokeStyle: outline.style }
              : {})
          }
        : {}),
      ...(radius ? { radius } : {}),
      ...(label ? { overLinks: true as const } : {})
    };
  }

  /**
   * The links from variables, each painting the element it reaches in its end's paint while it is
   * drawn, setting by setting: a link on a higher layer (its end's `layer`, 1 to 3) over a lower one,
   * and on one layer a link written later over an earlier one; those no free layout laid out as its own
   * are drawn by the page over everything, whatever layouts their ends are in: a straight line from
   * the node drawing the variable to the element, met at the edges of both boxes. A position past
   * its collection's last element (or before its first) reaches a ghost: an empty dashed box one
   * step on from the element at that end, so the link and its paint visibly move off the edge.
   */
  function linksFromVariables() {
    const centre = (box: PlacedBox) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2
    });
    // Where a line from a box's centre towards a point leaves the box.
    const edgeOf = (box: PlacedBox, towards: { x: number; y: number }) => {
      const c = centre(box);
      const dx = towards.x - c.x;
      const dy = towards.y - c.y;
      const scale = Math.min(
        dx ? box.width / 2 / Math.abs(dx) : Infinity,
        dy ? box.height / 2 / Math.abs(dy) : Infinity,
        1
      );
      return { x: c.x + dx * scale, y: c.y + dy * scale };
    };
    const layerOf = ({ marker }: Reaching) => Number(marker.attributes['data-target-layer']) || 1;
    for (const { marker, from, hidden } of [...reaching].sort((a, b) => layerOf(a) - layerOf(b))) {
      const attribute = (name: string) => marker.attributes[name];
      const id = attribute('data-sv-link');
      const { head, style } = markerLook(attribute);
      if (hidden || style.shown === false) continue;
      const to = attribute('data-to') ?? '';
      if (id && laidOut.has(id)) {
        paintTarget(described.get(elementAt(to)?.element as ModelElement), attribute);
        continue;
      }
      const reached = elementAt(to) ?? ghostOf(to, attribute);
      if (!reached) continue;
      paintTarget(described.get(reached.element), attribute);
      // A follower's arrow runs up from the top of its label to just under its child, at its
      // label's middle where the child is that wide, else at the child's nearer edge.
      const under = following.get(marker);
      const middle = centre(from).x;
      const start = under ? { x: middle, y: from.top } : edgeOf(from, centre(reached));
      const stop = under
        ? { x: Math.min(Math.max(middle, under.left), under.right), y: under.bottom }
        : edgeOf(reached, centre(from));
      const length = Math.hypot(stop.x - start.x, stop.y - start.y);
      if (length < 1) continue;
      const trim = Math.min(length - 1, headTrim(head?.shape, head?.size ?? 0));
      const end = {
        x: stop.x - ((stop.x - start.x) * trim) / length,
        y: stop.y - ((stop.y - start.y) * trim) / length
      };
      const third = (k: number) =>
        `${start.x + ((end.x - start.x) * k) / 3},${start.y + ((end.y - start.y) * k) / 3}`;
      linkOf(
        {
          path: `M ${start.x},${start.y} C ${third(1)} ${third(2)} ${end.x},${end.y}`,
          link: `${attribute('data-from') ?? ''} -> ${to}`,
          ...(id ? { id } : {}),
          heads: { start: false, end: true },
          ...(head ? { head } : {}),
          style
        },
        style,
        at.frame,
        0,
        0
      );
    }
  }

  /** A link end's paint on the node it reaches: fill, stroke and text colour (see endProps). */
  function paintTarget(
    node: SceneNode | undefined,
    attribute: (name: string) => string | undefined
  ) {
    if (!node) return;
    const paint = (name: string) => {
      const value = attribute(`data-target-${name}`);
      const split = value?.indexOf('|') ?? -1;
      if (!value || split < 0) return undefined;
      const css = substitutedOrNone(value.slice(split + 1), styledOf(at.frame).inherited.custom);
      return css ? { name: value.slice(0, split), css } : undefined;
    };
    const fill = paint('fill');
    const stroke = paint('stroke');
    const color = paint('color');
    if (fill) {
      node.look.fill = fill.css;
      node.colours = { ...node.colours, fill: fill.name };
    }
    if (stroke) {
      const width = Number(attribute('data-target-stroke-width'));
      node.look.stroke = stroke.css;
      node.look.strokeWidth = round((width > 0 ? width : 1.5) * fit);
      delete node.look.strokeStyle;
      node.colours = { ...node.colours, stroke: stroke.name };
    }
    if (color) {
      // The node's own text and that of the nodes inside it, as a link's target colour reaches them.
      const inside = new Set([node.id]);
      for (const each of nodes)
        if (each === node || (each.parent !== undefined && inside.has(each.parent))) {
          inside.add(each.id);
          each.look.color = color.css;
          for (const run of each.runs ?? []) run.color = color.css;
        }
      node.colours = { ...node.colours, color: color.name };
    }
  }

  /**
   * The ghost a position one past either end of its collection reaches: a dashed empty box one step
   * on from the element at that end, the step being how far the two elements there are apart (or
   * the element's width and a quarter, where it is alone), described as a node of its own.
   */
  function ghostOf(
    to: string,
    attribute: (name: string) => string | undefined
  ): (PlacedBox & { element: ModelElement }) | undefined {
    const match = /^(.*)\[(-?\d+)\]$/u.exec(to);
    if (!match) return undefined;
    const collection = match[1];
    const index = Number(match[2]);
    if (index < -1) return undefined;
    const near = elementAt(`${collection}[${index < 0 ? 0 : index - 1}]`);
    if (!near) return undefined;
    const beyond = elementAt(`${collection}[${index < 0 ? 1 : index - 2}]`);
    const step = beyond
      ? { x: near.left - beyond.left, y: near.top - beyond.top }
      : { x: near.width * 1.25, y: 0 };
    const ghost: PlacedBox = {
      left: near.left + step.x,
      top: near.top + step.y,
      width: near.width,
      height: near.height
    };
    const like = described.get(near.element);
    const paint = attribute('data-target-stroke') ?? attribute('data-target-fill');
    const css =
      (paint &&
        substitutedOrNone(
          paint.slice(paint.indexOf('|') + 1),
          styledOf(at.frame).inherited.custom
        )) ||
      like?.look.stroke ||
      '#737373';
    const element: ModelElement = { tag: 'div', attributes: {}, style: {}, children: [] };
    const node: SceneNode = {
      id: `${attribute('data-sv-link') ?? to}:ghost`,
      ...(like?.parent ? { parent: like.parent } : {}),
      box: sceneBox(ghost.left, ghost.top, ghost.width, ghost.height),
      look: {
        stroke: css,
        strokeWidth: round(1.5 * fit),
        strokeStyle: 'dashed',
        ...(like?.look.radius ? { radius: like.look.radius } : {}),
        color: like?.look.color ?? '#000000',
        font: like?.look.font ?? 'sans-serif',
        fontSize: like?.look.fontSize ?? round(16 * fit),
        fontWeight: 400
      }
    };
    nodes.push(node);
    return { element, ...ghost };
  }

  walk(at.flow, {
    layout: model.layOutAlone(at, at.flow, true),
    x: 0,
    y: 0,
    open: [],
    hidden: false,
    inPart: !part,
    label: false
  });
  linksFromVariables();
  const background = at.styled.get(at.frame)?.paint.background;
  const label = at.frame.attributes['data-sv-label'];
  return {
    scene: { nodes, links },
    ...(background ? { background } : {}),
    ...(frameRef && label ? { page: { id: frameRef, label } } : {})
  };
}

/**
 * The pieces of text inside a node, in order, each its own or, left out, undefined (see
 * readingText): its own outside its value, its drawings and its nodes, and not hidden, as the
 * nearest data-sv-hidden says (see ownText in ../scene.ts).
 */
function ownPieces(
  element: ModelElement,
  node: ModelElement,
  hiddenAbove: boolean
): (string | undefined)[] {
  const hidden =
    element.attributes['data-sv-hidden'] === undefined
      ? hiddenAbove
      : element.attributes['data-sv-hidden'] === 'true';
  const foreign =
    hidden ||
    element.tag === 'svg' ||
    classesOf(element).includes('value') ||
    (element !== node && element.tag === 'div' && element.attributes['data-sv-node'] !== undefined);
  return element.children.flatMap((child) =>
    isElement(child)
      ? ownPieces(child, node, hidden).map((piece) => (foreign ? undefined : piece))
      : [foreign ? undefined : child]
  );
}

/** Markup with one element replaced, sharing everything else. */
function replaced(
  element: ModelElement,
  target: ModelElement,
  replacement: ModelElement
): ModelElement {
  if (element === target) return replacement;
  let changed = false;
  const children = element.children.map((child) => {
    if (!isElement(child)) return child;
    const next = replaced(child, target, replacement);
    changed ||= next !== child;
    return next;
  });
  return changed ? { ...element, children } : element;
}

function* descendants(element: ModelElement): Generator<ModelElement> {
  for (const child of elementsOf(element)) {
    yield child;
    yield* descendants(child);
  }
}

function textOf(element: ModelElement): string {
  return element.children.map((child) => (isElement(child) ? textOf(child) : child)).join('');
}
