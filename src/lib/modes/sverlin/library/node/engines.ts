/**
 * Layout engines: what places a free layout's linked structure. Each takes the structure its links
 * make (see findStructure), every node's fixed size, and the room links and their labels need, and
 * gives each node's centre; the general layout (arrange.ts) then settles the nodes outside the
 * structure round it and routes the links. Each form is drawn by an engine: the app's own for its
 * forms (forms.ts), and `layered` by dagre, registered only where the server lays steps out
 * (layered-engine.ts), so no engine library reaches the page. The page places a free layout from
 * the server's solution; where it has none, as for a child the server did not know, it lays a
 * layered form out as natural. Another engine plugs in the same way: a form, and registerEngine.
 */

import { formCentres, type Direction, type Form, type Structure } from './forms';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** What an engine is given: the structure, each node's size, and the room between them. */
export type EngineInput = {
  structure: Structure;
  sizeOf: (node: number) => Size;
  /** Each link of the structure's, its label's size where it has one. */
  links: readonly { source: number; target: number; label?: Size }[];
  form: Form;
  /** Between linked nodes: an arrow's room, and its label's where links have labels. */
  room: number;
  /** Between nodes no link joins, side by side in a layer. */
  apart: number;
  random: (key: string) => number;
  direction?: Direction;
};

export type Engine = (input: EngineInput) => Map<number, Point>;

const registered = new Map<Form, Engine>();

/** Lets a form be drawn by an engine of its own, as layered by dagre on the server. */
export function registerEngine(form: Form, engine: Engine): void {
  registered.set(form, engine);
}

/**
 * Each node's centre, by its number, in pixels; any origin, as the caller centres them. A form with
 * an engine registered for it draws by that engine; any other, or one whose engine is not loaded
 * here, by the app's forms, a layered form as natural.
 */
export function engineCentres(input: EngineInput): Map<number, Point> {
  const engine = registered.get(input.form);
  if (engine) return engine(input);
  const form = input.form === 'layered' ? 'natural' : input.form;
  return formCentres(form, input.structure, input.sizeOf, input);
}
