// Fixed server entry for every presentation: work out every step's layout as the page would (see
// library/record.ts), from the same steps, markup and style sheets, inside an isolate with nothing
// of the server in it (see ../layout.server.ts). The host gives text widths and font metrics,
// measured in the fonts every page embeds, and takes the geometry back as JSON, with the frame and
// fit every step shows at, which the page draws with as given; what each step draws as
// __sverlinDrawn (see recordLayouts); and how large it draws as __sverlinSize. Given design values,
// it lays every step out with them in place of the variant's, to measure another arrangement (see
// arrangementsOnServer), recording nothing else; asked for representative steps only, it lays out
// the final state and the state holding the most, which show an arrangement nearly as well as every
// step does, for a fraction of the time.

import { render } from 'svelte/server';
import {
  Frame,
  emptyLayouts,
  fitShapes,
  geometryOf,
  pageAncestors,
  pageCss,
  recordLayouts,
  shownFrame,
  stepsOf,
  unpackStates,
  type FrameExtent,
  type ShownFrame
} from 'sverlin';
import MainServer from 'virtual:component-server';
import atoms from 'virtual:atoms';
import { components, lengths, listing, placements } from 'virtual:components';
import packed from 'virtual:trace';

type Host = {
  width(text: string, font: string): number;
  metrics(font: string): { ascent: number; descent: number; xHeight: number };
  report(message: string, step?: number): void;
};

const scope = globalThis as unknown as {
  __sverlinHost: Host;
  __sverlinLayOut?: (
    devicePixelRatio: number,
    design?: string,
    representative?: boolean
  ) => Promise<string>;
  __sverlinDrawn?: string;
  __sverlinDrawing?: string;
  __sverlinSize?: string;
  window?: unknown;
};
// The frame reads the window's size as it starts, for how far its canvas scales on screen, which
// nothing inside the frame is laid out by; the isolate has no window.
scope.window ??= { innerWidth: 1200, innerHeight: 800 };

const steps = stepsOf(unpackStates(packed), atoms, listing, lengths);
// Every step shares the variant, and so the frame's ratio.
const ratio = (steps.states[0] as { __frame?: { ratio?: string } } | undefined)?.__frame?.ratio;
const states = steps.states as { __design: Record<string, unknown> }[];
const variant = states.map(({ __design }) => __design);
// The final state, where a graph has every node and link it reaches, and the state holding the most,
// as its longest queue: drawn alike to the others where they are.
const holding = (state: number) => JSON.stringify(states[state]).length;
const representativeSteps = steps.distinct.length
  ? {
      ...steps,
      distinct: [
        ...new Set([
          steps.drawnLike[states.length - 1],
          steps.distinct.reduce((most, state) => (holding(state) > holding(most) ? state : most))
        ])
      ]
    }
  : steps;

scope.__sverlinLayOut = async (devicePixelRatio, design, representative) => {
  const values = design ? (JSON.parse(design) as Record<string, unknown>) : undefined;
  states.forEach((state, phase) => {
    state.__design = values ? { ...variant[phase], ...values } : variant[phase];
  });
  const host = scope.__sverlinHost;
  const borders = new Set<number>();
  const widths = new Map<string, number>();
  const metrics = new Map<string, ReturnType<Host['metrics']>>();
  const layouts = { ...emptyLayouts(), extents: new Map<number, FrameExtent>() };
  // The characters of text measured at each font size, each text once, for how large it reads.
  const characters = new Map<number, number>();
  // What is drawn is the same at any device pixel ratio but for borders snapping, so it is read once.
  const drawn: string[] | undefined = devicePixelRatio === 1 && !values ? [] : undefined;
  const reservation = await recordLayouts({
    steps: representative ? representativeSteps : steps,
    layouts,
    sizing: { components, placements },
    render: ({ props, settings, context }) =>
      render(Frame, { props: { view: MainServer, props, settings }, context }),
    measure: {
      width(text, font) {
        const key = `${font}\n${text}`;
        let width = widths.get(key);
        if (width === undefined) {
          widths.set(key, (width = host.width(text, font)));
          const size = Number(/([\d.]+)px/u.exec(font)?.[1]);
          if (size > 0 && text.trim())
            characters.set(size, (characters.get(size) ?? 0) + text.length);
        }
        return width;
      },
      metrics(font) {
        let known = metrics.get(font);
        if (!known) metrics.set(font, (known = host.metrics(font)));
        return known;
      }
    },
    sheet: pageCss,
    devicePixelRatio,
    borders,
    ancestors: pageAncestors,
    drawn,
    drawing: (drawing) => {
      if (drawn) scope.__sverlinDrawing = JSON.stringify(drawing);
    },
    report: (cause, step) =>
      host.report((cause instanceof Error ? cause.message : String(cause)).slice(0, 500), step)
  });
  const extents = [...layouts.extents.values()];
  const frame = shownFrame(extents, ratio === 'fit', fitShapes);
  if (drawn) scope.__sverlinDrawn = JSON.stringify(drawn);
  if (devicePixelRatio === 1) {
    const size = frame && drawnSize(extents, frame, characters);
    scope.__sverlinSize = size ? JSON.stringify(size) : undefined;
  }
  return JSON.stringify(geometryOf(layouts, { devicePixelRatio, borders }, frame, reservation));
};

/**
 * How large the frame every step shows in draws, with the parts of the step whose content needs
 * the most room in it, and the text sizes: the smallest, and the median by characters, half the
 * text at or under it.
 */
function drawnSize(
  extents: readonly FrameExtent[],
  { height, fit }: ShownFrame,
  characters: Map<number, number>
) {
  if (!extents.length || !characters.size) return undefined;
  const [{ frame, inside }] = extents;
  const room = (content: FrameExtent['content']) =>
    Math.max(
      content.width / inside.width,
      content.height / (height - frame.height + inside.height)
    );
  const largest = extents.reduce((most, extent) =>
    room(extent.content) > room(most.content) ? extent : most
  );
  const sizes = [...characters].sort(([a], [b]) => a - b);
  const total = sizes.reduce((sum, [, count]) => sum + count, 0);
  let counted = 0;
  const typical = sizes.find(([, count]) => (counted += count) >= total / 2)?.[0] ?? sizes[0][0];
  return {
    frame: { width: frame.width, height },
    fit,
    content: {
      width: Math.max(...extents.map(({ content }) => content.width)),
      height: Math.max(...extents.map(({ content }) => content.height))
    },
    parts: largest.parts,
    row: largest.row,
    text: { smallest: sizes[0][0], typical }
  };
}
