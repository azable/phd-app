// Fixed server entry for every presentation: work out every step's layout as the page would (see
// library/record.ts), from the same steps, markup and style sheets, inside an isolate with nothing
// of the server in it (see ../layout.server.ts). The host gives text widths and font metrics,
// measured in the fonts every page embeds, and takes the geometry back as JSON, and what each step
// draws as __sverlinDrawn (see recordLayouts).

import { render } from 'svelte/server';
import {
  Frame,
  emptyLayouts,
  geometryOf,
  pageAncestors,
  pageCss,
  recordLayouts,
  stepsOf,
  unpackStates
} from 'sverlin';
import MainServer from 'virtual:component-server';
import atoms from 'virtual:atoms';
import { components, listing, placements } from 'virtual:components';
import packed from 'virtual:trace';

type Host = {
  width(text: string, font: string): number;
  metrics(font: string): { ascent: number; descent: number; xHeight: number };
  report(message: string, step?: number): void;
};

const scope = globalThis as unknown as {
  __sverlinHost: Host;
  __sverlinLayOut?: (fonts: string, devicePixelRatio: number) => Promise<string>;
  __sverlinDrawn?: string;
  window?: unknown;
};
// The frame reads the window's size as it starts, for how far its canvas scales on screen, which
// nothing inside the frame is laid out by; the isolate has no window.
scope.window ??= { innerWidth: 1200, innerHeight: 800 };

scope.__sverlinLayOut = async (fonts, devicePixelRatio) => {
  const host = scope.__sverlinHost;
  const borders = new Set<number>();
  const widths = new Map<string, number>();
  const metrics = new Map<string, ReturnType<Host['metrics']>>();
  const layouts = emptyLayouts();
  // What is drawn is the same at any device pixel ratio but for borders snapping, so it is read once.
  const drawn: string[] | undefined = devicePixelRatio === 1 ? [] : undefined;
  const reservation = await recordLayouts({
    steps: stepsOf(unpackStates(packed), atoms, listing),
    layouts,
    sizing: { components, placements },
    render: ({ props, settings, context }) =>
      render(Frame, { props: { view: MainServer, props, settings }, context }),
    measure: {
      width(text, font) {
        const key = `${font}\n${text}`;
        let width = widths.get(key);
        if (width === undefined) widths.set(key, (width = host.width(text, font)));
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
    report: (cause, step) =>
      host.report((cause instanceof Error ? cause.message : String(cause)).slice(0, 500), step)
  });
  if (drawn) scope.__sverlinDrawn = JSON.stringify(drawn);
  return JSON.stringify(geometryOf(layouts, { fonts, devicePixelRatio, borders }, reservation));
};
