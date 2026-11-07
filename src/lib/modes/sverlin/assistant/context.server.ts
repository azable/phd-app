/**
 * The design part of the assistant's context (see $lib/server/ai/context/project-context.ts): a
 * version's design file as it is stored, and its design space as the model reads it, with its keys
 * as people and the model write them (see design-keys.ts).
 */

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import type { AiDesign, AiDesignContext, AiVariable } from '$lib/server/ai/context/project-context';
import { nestedDesign, writtenKey, writtenValues } from '../library/node/design-keys';
import {
  baseOptions,
  paletteKey,
  frameOptions,
  listingOptions,
  listingPlacesOptions,
  listingPropOptions,
  baseOf,
  tokenedOptions,
  isToken,
  propOptions,
  styleOf,
  tokenProps,
  type DesignProp
} from '../library/node/design';

type DesignValue = string | number | boolean;

/**
 * An option set of names written hue-shade, as colours are, told as a rule rather than listed: every
 * hue in every shade, with the other names it has. A colour prop listed its 200-odd colours, and a
 * design repeats them for fill, stroke, color and glow: about 9,000 characters a turn, every turn,
 * uncached (project d20bd3f6 on 5 November). Undefined where the names are not a full grid.
 */
function patternOf(set: readonly DesignValue[]): string | undefined {
  const pairs = set.flatMap((value) =>
    typeof value === 'string' && /^[a-z]+-\d+$/u.test(value) ? [value.split('-')] : []
  );
  if (pairs.length < 20) return undefined;
  const hues = [...new Set(pairs.map(([hue]) => hue))];
  const shades = [...new Set(pairs.map(([, shade]) => shade))];
  if (hues.length * shades.length !== pairs.length) return undefined;
  const others = set.filter((value) => !(typeof value === 'string' && /^[a-z]+-\d+$/u.test(value)));
  return `${others.length ? `${others.join(', ')}, or ` : ''}a hue-shade, as ${hues[1] ?? hues[0]}-${shades[Math.floor(shades.length / 2)]}: hues ${hues.join(', ')}; shades ${shades.join(', ')}`;
}

/**
 * The design as the assistant reads it: the stored file as it is, nested; every kind of node with
 * the props it has, kinds with the same props told once under their names joined by commas; the
 * option sets those props take; and in full, with their values, only the variables with options of
 * their own (views, a listing's language, a place's label). A kind's prop the file does not write
 * takes what the kind inherits, else its base's, else the prop's neutral value (see the guide).
 */
export function designContext(design: AiDesign): AiDesignContext {
  const kinds = new Map<string, string[]>();
  const variables = design.variables.filter((variable) => {
    const key = variable.variable;
    if (isToken(key) || baseOf(key) || styleOf(key) || paletteKey.test(key)) return false;
    if (key.startsWith('scale.')) return false;
    const dot = key.lastIndexOf('.');
    const prop = key.slice(dot + 1);
    const named = typeof variable.options === 'string';
    if (dot > 0 && named && (variable.options === prop || prop === 'inherit')) {
      const kind = writtenKey(key).slice(0, writtenKey(key).lastIndexOf('.'));
      kinds.set(kind, [...(kinds.get(kind) ?? []), prop === 'inherit' ? '...' : prop]);
      return false;
    }
    return true;
  });
  const grouped = new Map<string, string[]>();
  for (const [kind, props] of kinds) {
    const key = props.join(' ');
    grouped.set(key, [...(grouped.get(key) ?? []), kind]);
  }
  return {
    file: nestedDesign(writtenValues(design.file ?? {})),
    kinds: Object.fromEntries([...grouped].map(([props, names]) => [names.join(', '), props])),
    options: Object.fromEntries(
      Object.entries(design.options).map(([name, set]) => [writtenKey(name), patternOf(set) ?? set])
    ),
    variables: variables.map((variable) => ({
      ...variable,
      variable: writtenKey(variable.variable),
      ...(typeof variable.options === 'string' ? { options: writtenKey(variable.options) } : {})
    }))
  };
}

/**
 * A presentation's design space and variant, each prop's options named once, and its design file.
 * What a kind inherits takes every kind and every style the file writes, one set, `inherit`.
 */
export function designVariables(
  presentation:
    | Pick<BrowserBundlePresentation, 'variant' | 'design' | 'origins' | 'views' | 'listings'>
    | undefined,
  /** Each free layout's structure, by its kind (see SourceBuildFacts): only layers take layered. */
  structures?: Readonly<Record<string, string>>
): AiDesign {
  const options: Record<string, readonly DesignValue[]> = {};
  const variant = presentation?.variant ?? {};
  const styles = [...new Set(Object.keys(variant).flatMap((key) => styleOf(key)?.style ?? []))];
  const kinds = Object.keys(variant).flatMap((key) =>
    key.endsWith('.inherit') ? [key.slice(0, -'.inherit'.length)] : []
  );
  const variables = Object.entries(variant).map(([key, value]): AiVariable => {
    const origin = presentation?.origins?.[key];
    const told = (set: string | readonly DesignValue[]): AiVariable => ({
      variable: key,
      options: set,
      value,
      ...(origin ? { origin } : {})
    });
    if (key.endsWith('.inherit')) {
      options.inherit = [...kinds, ...styles];
      return told('inherit');
    }
    const style = styleOf(key);
    if (style && Object.hasOwn(propOptions, style.prop)) {
      options[style.prop] = baseOptions(style.prop, propOptions[style.prop as DesignProp], variant);
      return told(style.prop);
    }
    // A token's options are its prop's; a base's, its prop's and the tokens that fit it.
    if (isToken(key)) {
      const set = tokenProps[key];
      options[set] = baseOptions(set, propOptions[set], variant);
      return told(set);
    }
    const base = baseOf(key);
    if (base) {
      options[key] = tokenedOptions(base.prop, base.base === '<Link>.<To>');
      return told(key);
    }
    // A place's own choice, as views.Int:swap.held or views.Ask.Int:g.a, has its type's options; a
    // label's view, as views.@scan.check, is the label's.
    const typeIn = (rest: string) => {
      const type = rest.split(':')[0];
      return type.startsWith('@') ? type : (type.split('.').at(-1) ?? rest);
    };
    const view = key.startsWith('views.') ? typeIn(key.slice('views.'.length)) : undefined;
    const prop =
      key === '<Listing>.language' || key === '<Listing>.places'
        ? key
        : key.slice(key.lastIndexOf('.') + 1);
    // A listing's text colour has options of its own, which can keep the listing's ink.
    const set =
      prop === 'color' && key.startsWith('<Listing>.')
        ? 'listing.color'
        : prop === 'form' && structures?.[key.slice(0, -'.form'.length)] !== 'layers'
          ? 'form.unlayered'
          : prop;
    const known: Record<string, readonly DesignValue[]> = {
      ...propOptions,
      ...frameOptions,
      '<Listing>.language': listingOptions['<Listing>.language'],
      '<Listing>.places': listingPlacesOptions,
      'listing.color': listingPropOptions('color') ?? [],
      // The forms of a layout whose links make no layers, which do not take layered.
      'form.unlayered': propOptions.form.filter((form) => form !== 'layered')
    };
    if (!view && Object.hasOwn(known, set)) options[set] = baseOptions(set, known[set], variant);
    // Scales and palette colours are free within their form (see withBase).
    if (key.startsWith('scale.')) return told(['rising numbers, 0 or more, separated by spaces']);
    if (paletteKey.test(key)) return told(['an exact colour, # and six hex digits']);
    return told(
      view
        ? [...(presentation?.views?.[view] ?? []), 'none']
        : key === '<Listing>.language' && presentation?.listings?.length
          ? [...presentation.listings, ...listingOptions['<Listing>.language']]
          : set
    );
  });
  return { options, variables, ...(presentation?.design ? { file: presentation.design } : {}) };
}
