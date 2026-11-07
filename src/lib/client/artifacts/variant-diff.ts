/**
 * Variants as JSON documents whose rows line up, for a diff of a compared pair.
 *
 * @packageDocumentation
 */

import {
  FlatDesignError,
  flatDesign,
  keptValues,
  kindKeyParts,
  nestedDesign,
  writtenValues
} from '$lib/modes/sverlin/library/node/design-keys';
import { placeCaption } from '$lib/modes/sverlin/library/node/design';
import type { DesignValues } from '$lib/shared/presentations';

/**
 * A variant as JSON in its nested form (see nestedDesign), its keys as written and in one order,
 * so two variants' rows line up and differ only where their values do.
 */
export function variantDocument(variant: DesignValues): string {
  return JSON.stringify(nestedDesign(writtenValues(variant)), null, 2);
}

/**
 * An edit of a version's choices as their document (see variantDocument): the values it changes or
 * adds, to build with as chosen, and the variables it removes, to stop keeping, so every value left
 * as it was keeps following what it inherits, its role's style or its token; or why the text is not
 * such a document. The document is the whole design, nested (see flatDesign): a key removed, or
 * set to null as a JSON Merge Patch removes one, returns to what it follows. A value is
 * a string, a number or a boolean, as a variant's are.
 */
export function choiceEdits(
  shown: DesignValues,
  text: string
): { chosen: DesignValues; unset: string[] } | { error: string } {
  let edited: unknown;
  try {
    edited = JSON.parse(text);
  } catch (cause) {
    return { error: `The choices are not valid JSON: ${(cause as Error).message}` };
  }
  if (!edited || typeof edited !== 'object' || Array.isArray(edited))
    return { error: 'The choices must be one JSON object, each variable to its value.' };
  let flat: Record<string, unknown>;
  try {
    flat = flatDesign(edited as Record<string, unknown>);
  } catch (cause) {
    if (cause instanceof FlatDesignError) return { error: cause.message };
    throw cause;
  }
  const entries = Object.entries(flat);
  const wrong = entries.find(
    ([, value]) => value !== null && !['string', 'number', 'boolean'].includes(typeof value)
  );
  if (wrong)
    return {
      error: `${wrong[0]} must be a string, a number or a boolean, not ${JSON.stringify(wrong[1])}.`
    };
  // Compared as the app keeps them: the document writes its keys in the written form.
  const kept = keptValues(
    Object.fromEntries(entries.filter(([, value]) => value !== null)) as DesignValues
  );
  return {
    chosen: Object.fromEntries(
      Object.entries(kept).filter(
        ([key, value]) => !Object.hasOwn(shown, key) || shown[key] !== value
      )
    ) as DesignValues,
    unset: Object.keys(shown).filter((key) => !Object.hasOwn(kept, key))
  };
}

/** The keys whose values two variants do not share, a key only one of them sets included. */
export function differingKeys(a: DesignValues, b: DesignValues): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !(key in a && key in b && a[key] === b[key]))
    .sort((x, y) => x.localeCompare(y));
}

/** A variable of a variant in words, with the value each variant shown gives it. */
export type ChoiceRow = { key: string; name: string; values: string[] };

/** The variables named, each with its value in each variant, in plain words for participants. */
export function choiceRows(
  variants: readonly DesignValues[],
  keys: readonly string[]
): ChoiceRow[] {
  return keys.map((key) => ({
    key,
    name: choiceName(key),
    values: variants.map((variant) => choiceValue(key, variant[key]))
  }));
}

// The variables of a type's views, by their key's first part, as `views.Int`.
const viewCategories: Record<string, string> = { views: 'view' };

/**
 * A variable's key in words: its kind's and prop's names split into words, its place as “for …”
 * and a value of the data as “when …”: `Mark.<Link>:pair.left.targetFill` is “Mark link target
 * fill for pair.left”, `Card=true.fill` “Card fill when true”, and `views.Int:swap.held` “Int view
 * for swap.held”. Whether something is shown is said by its value (`choiceValue`), not its name.
 */
export function choiceName(key: string): string {
  const caption = placeCaption.exec(key);
  if (caption) return sentence(`caption for ${caption[1]}`);
  const view = /^(views)\.(@[\w$.]+?|[\w$.]+?)(?::(@?[\w$.]+))?$/u.exec(key);
  if (view) {
    const [, category, type, place] = view;
    const name = `${words(type)} ${viewCategories[category]}`;
    return sentence(place ? `${name} for ${place}` : name);
  }
  // A built-in name, as `<Value>.padding`, reads as its words: “Value padding”.
  const builtIn = /^<(\w+)>\.([\w.]+)$/u.exec(key);
  if (builtIn) return sentence([builtIn[1], ...builtIn[2].split('.')].map(words).join(' '));
  const parts = kindKeyParts(key);
  if (!parts) return sentence(key.split('.').map(words).join(' ') || key);
  const named = [...parts.kind.split('.'), ...(parts.prop === 'shown' ? [] : [parts.prop])];
  if (parts.part) named.push(parts.part);
  const name = named.map(words).join(' ');
  const where = parts.place ? ` for ${parts.place}` : '';
  const when = parts.value !== undefined ? ` when ${parts.value}` : '';
  return sentence(`${name}${where}${when}`);
}

/** A variable's value as written, whether something is shown as shown or hidden. */
export function choiceValue(key: string, value: DesignValues[string] | undefined): string {
  if (value === undefined) return 'not set';
  if (typeof value !== 'boolean') return String(value);
  if (key === 'shown' || key.endsWith('.shown')) return value ? 'shown' : 'hidden';
  return value ? 'yes' : 'no';
}

/** A name in lower-case words: `IntCell` is “int cell”, `fill-color` “fill color”. */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/[<>]/g, '')
    .toLowerCase();
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
