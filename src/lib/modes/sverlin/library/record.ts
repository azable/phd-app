/**
 * Every step's layout worked out before any is shown, without mounting any (see LayoutMemory), from
 * the steps' markup as Svelte's string renderer writes it. The page does it (see
 * ../assembly/entry.ts) where the server gave it none, and the server does it (see
 * ../assembly/layout.ts), with the same steps, markup, style sheets and font files.
 */

import { linePairs } from './node/lines';
import { parseSheet, type Rule } from './model/css';
import type { TextMeasure } from './model/layout';
import { styler } from './model/look';
import { readMarkup } from './model/markup';
import {
  describeDrawn,
  elementsUnder,
  probeComponent,
  reserveSizes,
  withLines,
  type Drawing,
  type Reservation,
  type ReserveOptions
} from './model/reserve';
import type { ModelElement } from './model/tree';
import { withValue, type Layouts, type StepDrawing, type Steps, type StepState } from './steps';
import type { LayoutMemory } from './type-context';
import { widestInteger } from './widest-number';

/**
 * The view's typed components, each after those it renders, with the values to draw it with; and
 * the values its root reads for placement, by path, with the step they are measured at.
 */
export type Sizing = {
  components: {
    name: string;
    cases: unknown[];
    range?: { min: number; max: number; places?: number };
  }[];
  placements: { path: string; step: number; values: unknown[] }[];
};

export type RecordOptions = {
  steps: Steps;
  layouts: Layouts;
  sizing: Sizing;
  /** A step drawn as Svelte's string renderer writes it: its head and its body. */
  render: (drawing: StepDrawing) => { head: string; body: string };
  measure: TextMeasure;
  /** The page's own style sheet: its theme and the layers steps are drawn in. */
  sheet: string;
  devicePixelRatio: number;
  /** Collects every border width as written, before it snaps to device pixels (see geometry.ts). */
  borders?: Set<number>;
  /** The page's elements around the layer a step is drawn in, outermost first. */
  ancestors: readonly ModelElement[];
  /** A step the view failed to draw, with why. */
  report: (cause: unknown, step?: number) => void;
  /**
   * Collects what each step draws, once laid out, as a key (see describeDrawn): two steps, of one
   * presentation or two, have the same key where they draw the same picture.
   */
  drawn?: string[];
  /** Gives the page back for a moment between the parts of the work. */
  pause?: () => Promise<void>;
  /** Called as each part ends. */
  timed?: (phase: 'measuring' | 'recording') => void;
};

/** The element each step's markup is read into, as the page's layers are. */
const layer: ModelElement = {
  tag: 'div',
  attributes: { class: 'sv-layer pending' },
  style: {},
  children: []
};

/**
 * Draw the first of each of the states drawn alike (see Steps), find the pairs of links drawn as one
 * line, size each typed component over the values of its parameters, then lay every node out on the
 * layout model, bottom up, each keeping the largest size it reaches and each free layout solved once
 * over every step (see model/reserve.ts).
 */
export async function recordLayouts(options: RecordOptions): Promise<Reservation> {
  const { steps, layouts, sizing, measure, report } = options;
  // The style sheets of the library's components, by id, as their markup brings them, and the rules
  // the layout model reads, worked out again for new ones.
  const componentSheets = new Map<string, string>();
  let model: { rules: Rule[]; styler: ReturnType<typeof styler> } | undefined;
  const modelRules = () => {
    if (!model) {
      const rules = parseSheet(options.sheet);
      for (const sheet of componentSheets.values()) rules.push(...parseSheet(sheet, rules.length));
      model = { rules, styler: styler(rules, options.devicePixelRatio, options.borders) };
    }
    return model;
  };
  /**
   * A step's markup; `extra` and `substituted` are as for drawingOf. A view that fails at a step
   * reports why, and one failing with substituted values, which no run produces, is left out.
   */
  const drawMarkup = (
    step: number,
    extra?: Record<string, unknown>,
    substituted?: StepState
  ): ModelElement | undefined => {
    try {
      const { head, body } = options.render(
        steps.drawingOf(step, 'measuring', layouts, extra, substituted)
      );
      for (const [, id, sheet] of head.matchAll(/<style id="([^"]*)">([\s\S]*?)<\/style>/gu))
        if (!componentSheets.has(id)) {
          componentSheets.set(id, sheet);
          model = undefined;
        }
      return readMarkup(body, layer);
    } catch (cause) {
      if (!substituted) report(cause, step);
      return undefined;
    }
  };

  const drawn = new Map<number, ModelElement>();
  for (const step of steps.distinct) {
    const markup = drawMarkup(step);
    if (markup) drawn.set(step, markup);
  }
  // The links each step shows, by pair and way, for the pairs drawn as one line (see linePairs).
  const shownLinks: Set<string>[] = [];
  for (const [step, markup] of drawn)
    shownLinks[step] = new Set(
      [...elementsUnder(markup)]
        .filter(
          ({ attributes }) =>
            attributes['data-sv-pair'] !== undefined && attributes['data-shown'] !== 'false'
        )
        .map(({ attributes }) => `${attributes['data-sv-pair']}|${attributes['data-sv-way']}`)
    );
  steps.states.forEach(
    (_, step) => (shownLinks[step] = shownLinks[steps.drawnLike[step]] ?? new Set())
  );
  for (const pair of linePairs(shownLinks)) layouts.lines.add(pair);
  const drawings: Drawing[] = [...drawn].map(([step, markup]) => ({
    step,
    markup: withLines(markup, layouts.lines)
  }));
  // Values the root reads for placement are drawn with every value of their types, in a step where
  // they are recorded, so it has room for values the trace never reaches.
  for (const { path, step, values } of sizing.placements)
    for (const value of values) {
      const markup = drawMarkup(
        step,
        undefined,
        withValue(steps.states[step] as StepState, path, value)
      );
      if (markup) drawings.push({ markup: withLines(markup, layouts.lines) });
    }
  options.timed?.('measuring');
  await options.pause?.();
  const memory: LayoutMemory = { ...layouts, step: 0 };
  const reserveOptions = () => ({
    ...modelRules(),
    measure,
    devicePixelRatio: options.devicePixelRatio,
    ancestors: options.ancestors,
    memory
  });
  // A typed component is drawn once with each value of its type it is sized by, and its root keeps
  // the largest box it reaches: every value has room, whether or not this trace ever shows it.
  // Components come after those they render, whose boxes they are drawn with.
  for (const { name, cases, range } of sizing.components) {
    const probe = (values: unknown[]) => {
      const markup = drawMarkup(0, { __probe: { component: name, cases: values } });
      if (!markup) return undefined;
      const { box, font } = probeComponent(
        withLines(markup, layouts.lines),
        name,
        reserveOptions()
      );
      if (box) layouts.components.set(name, box);
      return font;
    };
    const font = probe(cases);
    // Digits differ in width in most fonts, and the font is drawn per presentation, so a range too
    // large to draw whole is drawn again with the integer that prints widest in the value's font.
    if (range && font) {
      const widest = widestInteger(
        range.min,
        range.max,
        (character) => measure.width(character, font),
        range.places
      );
      if (!cases.includes(widest)) probe([widest]);
    }
  }
  const reservation = reserveSizes(drawings, reserveOptions());
  steps.states.forEach((_, step) => {
    const fit = layouts.fits.get(steps.drawnLike[step]);
    if (fit !== undefined) layouts.fits.set(step, fit);
  });
  options.timed?.('recording');
  if (options.drawn) options.drawn.push(...drawnKeys(options, reserveOptions()));
  return reservation;
}

/**
 * Each step's key: its two states (see stepsOf), each drawn as it is shown, with the layout memory
 * now complete, and the fit it is drawn at.
 */
function drawnKeys(options: RecordOptions, reserve: ReserveOptions): string[] {
  const { steps, layouts } = options;
  const described = new Map<number, string>();
  for (const state of steps.distinct) {
    try {
      const { body } = options.render(steps.drawingOf(state, 'showing', layouts));
      const markup = withLines(readMarkup(body, layer), layouts.lines);
      described.set(state, describeDrawn(markup, reserve) ?? '');
    } catch {
      // A state the view fails to draw is reported as it is measured.
      described.set(state, 'failed');
    }
  }
  return Array.from({ length: steps.stepCount }, (_, step) =>
    hashed(
      [2 * step, 2 * step + 1]
        .map((state) => described.get(steps.drawnLike[state]) ?? '')
        .concat(String(layouts.fits.get(2 * step + 1) ?? ''))
        .join('\n\n')
    )
  );
}

/** A 53-bit hash of text, in hexadecimal (cyrb53, public domain): keys compared, not secured. */
function hashed(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
