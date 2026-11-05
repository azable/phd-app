/**
 * A step's scene (see ../scene.ts) worked out on the layout model from the markup of the state it
 * shows, as the page's describeStep reads it from a mounted layer, so a scene needs no browser:
 * every node's box and look, its text in lines, its listing marks and its drawings' shapes, and
 * every link, a free layout's as the server routes it (see routesOf in reserve.ts) and a row's,
 * column's or grid's as LinkOverlay routes it, with their labels. The root is drawn at the frame's
 * fit, as Frame.svelte draws it: placed at the frame's padding, its least size the frame's inside.
 */

import { arrangeChildren, type ArrangementProps } from '../node/arrangement';
import { lineColour } from '../listing/places';
import { shadows, type Shadow } from '../node/design';
import { headDrawing } from '../node/heads';
import type { Line, LineStyle } from '../node/LinkLines.svelte';
import { routeOverlay } from '../node/overlay';
import type { Layout } from '../node/props';
import {
  readingText,
  sceneLink,
  type SceneBox,
  type SceneFrame,
  type SceneLink,
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

/** A node round what is walked; described, unless it is hidden. */
type Open = { element: ModelElement; node?: SceneNode };

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
    if (attributes['data-sv-link'] !== undefined) return;
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
    for (const edge of arranged.edges) {
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
    const parent = open.at(-1)?.element.attributes['data-sv-node'] ?? frameRef;
    const shadow = attributes['data-sv-shadow'];
    return {
      id: attributes['data-sv-node'] ?? '',
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
        ...(attributes['data-sv-fill-style'] === 'hatched' ? { fillStyle: 'hatched' as const } : {})
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

  walk(at.flow, {
    layout: model.layOutAlone(at, at.flow, true),
    x: 0,
    y: 0,
    open: [],
    hidden: false,
    inPart: !part,
    label: false
  });
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
