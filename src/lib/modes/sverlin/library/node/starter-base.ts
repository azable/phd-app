/**
 * The starter base, `<starter>`: every token, every role's look (`<Value>`, …), the scales, a second
 * state's style (`$second`) and the listing's look, as the assistant's other templates hold them
 * (see ../../assistant/templates). It is the engine's because every design names a base, and a
 * design that enters the app naming none, as a demo example's or a test's, has this one written in
 * (see withStarterBase in ../../design.server.ts); the assistant's `starter` template is this file.
 */

import { baseKey, starterName } from './design';
import { flatDesign } from './design-keys';
import starter from './starter-base.json';

export const starterBaseName = starterName;

/** The starter base's values, flat, its name included, as a design holds them. */
export const starterBase: Readonly<Record<string, string | number | boolean>> = {
  [baseKey]: starterBaseName,
  ...(flatDesign(starter) as Record<string, string | number | boolean>)
};
