/**
 * The design templates, each a design file (see nestedDesign in ../library/node/design-keys.ts):
 * tokens, scales, a palette where it uses exact colours, the role styles (`<Value>`, …), styles as
 * `$second`, and the listing's look. A first version names one, as `"template": "$slide"`, and the
 * build copies its file in as the version's design, which later versions change (see buildVariant
 * in ../design.server.ts); the design keeps no link to it. `starter` keeps the app's first look;
 * the others follow the principles in assistant.md's Templates. Browser-safe.
 */

import { flatDesign, keptValues } from '../library/node/design-keys';
import highContrast from './high-contrast.json';
import slide from './slide.json';
import starter from './starter.json';
import textbook from './textbook.json';

type DesignValue = string | number | boolean;

export const templates = {
  starter,
  textbook,
  slide,
  'high-contrast': highContrast
} as const satisfies Record<string, Record<string, unknown>>;

export type TemplateName = keyof typeof templates;

/** A template's name as a design writes it, with `$`, as `$textbook`. */
export const templateName = (name: TemplateName): string => `$${name}`;

/** Every template's name as written, as `$starter, $textbook, …`. */
export const templateNames = (): string =>
  (Object.keys(templates) as TemplateName[]).map(templateName).join(', ');

/** The template a name, as `$textbook`, names, if it names one. */
export function templateOf(name: unknown): TemplateName | undefined {
  return (Object.keys(templates) as TemplateName[]).find((each) => templateName(each) === name);
}

/** A template's file, flat, its keys as the app keeps them, as `<Value>.fill` and `scale.spacing`. */
export function templateValues(name: TemplateName): Record<string, DesignValue> {
  return keptValues(flatDesign(templates[name]) as Record<string, DesignValue>);
}
