/**
 * The assistant's templates: whole bases, each a nested design (see nestedDesign in
 * ../../library/node/design-keys.ts) of every token, every role's look (`$Value`, …), the scales,
 * a palette where it uses exact colours, a second state's style (`$second`), and the listing's
 * look. A design names one as `"...": "$textbook"` and patches it; the app writes the template
 * out in full into the design (see readDesignPatch), so the Timeline records every base value and
 * the build never reads a template. `starter` is the engine's starter base, written into a design
 * that names none (see ../../library/node/starter-base.ts); the others follow the principles in
 * assistant.md's Templates.
 */

import { flatDesign } from '../../library/node/design-keys';
import starter from '../../library/node/starter-base.json';
import highContrast from './high-contrast.json';
import slide from './slide.json';
import textbook from './textbook.json';

type DesignValue = string | number | boolean;

export const templates = {
  starter,
  textbook,
  slide,
  'high-contrast': highContrast
} as const satisfies Record<string, Record<string, unknown>>;

export type TemplateName = keyof typeof templates;

/** The template a base's name, as `$textbook`, names, if it names one. */
export function templateOf(base: unknown): TemplateName | undefined {
  const name = typeof base === 'string' && base.startsWith('$') ? base.slice(1) : undefined;
  return name !== undefined && Object.hasOwn(templates, name) ? (name as TemplateName) : undefined;
}

/** A template's values, flat, with their keys as written, as `$Value.fill` and `scale.spacing`. */
export function templateValues(name: TemplateName): Record<string, DesignValue> {
  return flatDesign(templates[name]) as Record<string, DesignValue>;
}
