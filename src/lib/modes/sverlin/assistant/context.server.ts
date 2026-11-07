/**
 * The design part of the assistant's context (see $lib/server/ai/context/project-context.ts): a
 * version's design space and variant as the model reads it, with its keys as people and the model
 * write them (see design-keys.ts).
 */

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import type { AiDesign, AiDesignContext, AiVariable } from '$lib/server/ai/context/project-context';
import { writtenKey } from '../library/node/design-keys';
import {
  templateName,
  templates,
  withoutTemplateValues,
  type TemplateName
} from '../templates/templates';
import {
  baseKey,
  baseOptions,
  paletteKey,
  frameOptions,
  listingOptions,
  listingPlacesOptions,
  listingPropOptions,
  roleStyleOf,
  roleStyleOptions,
  isToken,
  levelFor,
  propOptions,
  styleOf,
  tokenProps,
  type DesignProp,
  type KindRole
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

export function designContext(design: AiDesign): AiDesignContext {
  const { options, variables } = withoutBase(writtenDesign(design));
  const values: Record<string, Record<string, DesignValue>> = {};
  const levels: Record<string, DesignValue | Record<string, DesignValue>> = {};
  const followers = new Map<string, Set<string>>();
  const own = variables.filter(({ variable, value, follows }) => {
    const style = styleOf(variable);
    const roleStyle = roleStyleOf(variable);
    if (isToken(variable)) levels[variable] = value;
    else if (roleStyle)
      (
        (levels[variable.slice(0, variable.lastIndexOf('.'))] ??= {}) as Record<string, DesignValue>
      )[roleStyle.prop] = value;
    // A style is a level of its own, as a role's style is; what a kind inherits is told as "..."
    // with the kind's own values.
    else if (style)
      ((levels[style.style] ??= {}) as Record<string, DesignValue>)[style.prop] = value;
    else if (variable.endsWith('.inherit'))
      (values[variable.slice(0, -'.inherit'.length)] ??= {})['...'] = value;
    else if (follows && !isToken(follows)) {
      const group = follows.slice(0, follows.lastIndexOf('.'));
      followers.set(
        group,
        (followers.get(group) ?? new Set()).add(variable.slice(0, variable.lastIndexOf('.')))
      );
    } else return true;
    return false;
  });
  for (const [group, kinds] of followers)
    if (typeof levels[group] === 'object')
      (levels[group] as Record<string, DesignValue>).kinds = [...kinds].join(', ');
  const full = own.filter(({ variable, options: set, value, origin, follows }) => {
    const dot = variable.lastIndexOf('.');
    const prop = variable.slice(dot + 1);
    const brief =
      dot > 0 &&
      typeof set === 'string' &&
      set === prop &&
      ((origin !== 'chosen' && origin !== 'random') || follows !== undefined);
    // A prop following a token is told as the token, whose value levels gives.
    if (brief) (values[variable.slice(0, dot)] ??= {})[prop] = follows ?? value;
    return !brief;
  });
  // Kinds whose values are all alike are told once, under their names joined by commas: most text
  // and container kinds keep the same starter values (about half of design.values in a graph).
  const grouped = new Map<string, string[]>();
  for (const [kind, props] of Object.entries(values)) {
    const key = JSON.stringify(props);
    grouped.set(key, [...(grouped.get(key) ?? []), kind]);
  }
  const told = Object.fromEntries(
    [...grouped].map(([key, kinds]) => [
      kinds.join(', '),
      JSON.parse(key) as Record<string, DesignValue>
    ])
  );
  const toldOptions = Object.fromEntries(
    Object.entries(options).map(([name, set]) => [name, patternOf(set) ?? set])
  );
  return {
    options: toldOptions,
    variables: full,
    values: told,
    ...(Object.keys(levels).length ? { levels } : {})
  };
}

/**
 * The design told against the template it names as its base (see templates.ts): every value still
 * the template's is left out, as the base's name says it, so the context lists only the
 * differences, not the base's 200-odd values.
 */
function withoutBase(design: AiDesign): AiDesign {
  const told = withoutTemplateValues(
    Object.fromEntries(design.variables.map(({ variable, value }) => [variable, value]))
  );
  return {
    options: design.options,
    variables: design.variables.filter(({ variable }) => Object.hasOwn(told, variable))
  };
}

/**
 * The design with its keys as the assistant reads and writes them (see design-keys.ts): `{Int}`,
 * `IntCell:target.stroke`, `Card=true.stroke`; the app keeps the other form, and converts back what
 * the assistant sends.
 */
function writtenDesign({ options, variables }: AiDesign): AiDesign {
  const written = (key: string) => writtenKey(key);
  return {
    options: Object.fromEntries(Object.entries(options).map(([name, set]) => [written(name), set])),
    variables: variables.map((variable) => ({
      ...variable,
      variable: written(variable.variable),
      ...(typeof variable.options === 'string' ? { options: written(variable.options) } : {}),
      ...(variable.follows ? { follows: written(variable.follows) } : {})
    }))
  };
}

/** A presentation's design space and variant, each prop's options named once. */
export function designVariables(
  presentation:
    | Pick<BrowserBundlePresentation, 'variant' | 'origins' | 'views' | 'listings' | 'roles'>
    | undefined,
  /** Each free layout's structure, by its kind (see SourceBuildFacts): only layers take layered. */
  structures?: Readonly<Record<string, string>>
): AiDesign {
  const options: Record<string, readonly DesignValue[]> = {};
  const variant = presentation?.variant ?? {};
  const roles = (presentation?.roles ?? {}) as Readonly<Record<string, KindRole>>;
  // What a kind's prop follows where it holds that value (see buildVariant): what it inherits,
  // as $cell.padding or VertexCard.padding, its role's style, as <Value>.padding, or the token
  // its role's look names, as $spacing.
  const followed = (key: string): string | undefined => {
    const level = levelFor(variant, roles, key);
    return level?.value !== undefined && level.value === variant[key] ? level.from : undefined;
  };
  const styles = [...new Set(Object.keys(variant).flatMap((key) => styleOf(key)?.style ?? []))];
  const variables = Object.entries(variant).map(([key, value]): AiVariable => {
    const origin = presentation?.origins?.[key];
    // What a kind inherits takes the kinds of its role, or a style the variant sets; a
    // style's prop, its prop's options.
    if (key.endsWith('.inherit')) {
      const kind = key.slice(0, -'.inherit'.length);
      const peers = Object.keys(roles).filter(
        (other) => other !== kind && roles[other] === roles[kind]
      );
      return {
        variable: key,
        options: [...peers, ...styles],
        value,
        ...(origin ? { origin } : {})
      };
    }
    const style = styleOf(key);
    if (style && Object.hasOwn(propOptions, style.prop)) {
      options[style.prop] = baseOptions(style.prop, propOptions[style.prop as DesignProp], variant);
      return { variable: key, options: style.prop, value, ...(origin ? { origin } : {}) };
    }
    // A token's options are its prop's; a role level's, its prop's and the tokens that fit it.
    if (isToken(key)) {
      const set = tokenProps[key];
      options[set] = baseOptions(set, propOptions[set], variant);
      return { variable: key, options: set, value, ...(origin ? { origin } : {}) };
    }
    const roleStyle = roleStyleOf(key);
    if (roleStyle) {
      options[key] = roleStyleOptions(roleStyle.prop as DesignProp);
      return { variable: key, options: key, value, ...(origin ? { origin } : {}) };
    }
    const follows = followed(key);
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
    // A base's name, scales and palette are free within their form (see withBase).
    const ofBase =
      key === baseKey
        ? [
            ...(Object.keys(templates) as TemplateName[]).map(templateName),
            '$ and a name of your own'
          ]
        : key.startsWith('scale.')
          ? ['rising numbers, 0 or more, separated by spaces']
          : paletteKey.test(key)
            ? ['an exact colour, # and six hex digits']
            : undefined;
    if (ofBase) return { variable: key, options: ofBase, value, ...(origin ? { origin } : {}) };
    return {
      variable: key,
      options: view
        ? [...(presentation?.views?.[view] ?? []), 'none']
        : key === '<Listing>.language' && presentation?.listings?.length
          ? [...presentation.listings, ...listingOptions['<Listing>.language']]
          : set,
      value,
      ...(origin ? { origin } : {}),
      ...(follows ? { follows } : {})
    };
  });
  return { options, variables };
}
