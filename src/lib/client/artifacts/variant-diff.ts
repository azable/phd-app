/**
 * Variants as JSON documents whose rows line up, for a diff of a compared pair.
 *
 * @packageDocumentation
 */

import type { DesignValues } from '$lib/shared/presentations';

/**
 * A variant as JSON, one row per value, its keys in one order, so two variants' rows line up and
 * differ only where their values do.
 */
export function variantDocument(variant: DesignValues): string {
  const sorted = Object.entries(variant).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sorted), null, 2);
}

/**
 * A developer's edit of a version's choices as their document (see variantDocument): the values
 * it changes or adds, to build with as chosen, and the variables it removes, to stop keeping, so
 * every value left as it was keeps following its token or group; or why the text is not such a
 * document. A value is a string, a number or a boolean, as a variant's are.
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
  const entries = Object.entries(edited);
  const wrong = entries.find(
    ([, value]) => !['string', 'number', 'boolean'].includes(typeof value)
  );
  if (wrong)
    return {
      error: `${wrong[0]} must be a string, a number or a boolean, not ${JSON.stringify(wrong[1])}.`
    };
  return {
    chosen: Object.fromEntries(
      entries.filter(([key, value]) => !Object.hasOwn(shown, key) || shown[key] !== value)
    ) as DesignValues,
    unset: Object.keys(shown).filter((key) => !Object.hasOwn(edited, key))
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
const viewCategories: Record<string, string> = { views: 'view', pointers: 'pointer' };

/**
 * A variable's key in words: its kind's and prop's names split into words, and its place, after
 * `@`, as “for …”: `Highlight.Pointed@pair.left.fill` is “Highlight pointed fill for pair.left”,
 * and `views.Int@swap.held` “Int view for swap.held”.
 * Whether something is shown is said by its value (`choiceValue`), not its name.
 */
export function choiceName(key: string): string {
  const at = key.indexOf('@');
  const head = at < 0 ? key : key.slice(0, at);
  const tail = at < 0 ? undefined : key.slice(at + 1);
  const [category, type, ...rest] = head.split('.');
  if (category in viewCategories && type && !rest.length) {
    const name = `${words(type)} ${viewCategories[category]}`;
    return sentence(tail ? `${name} for ${tail}` : name);
  }
  // A group, as `<Node>.padding`, sets every kind of its tag: “Every node padding”.
  const tag = /^<(\w+)>$/u.exec(category);
  if (tag && type && !rest.length && tail === undefined)
    return sentence(`every ${words(tag[1])} ${words(type)}`);
  // A kind's prop: the key's last part, after the place where there is one.
  const parts = tail === undefined ? head.split('.') : [...head.split('.'), tail];
  let place: string | undefined;
  if (tail !== undefined) {
    const dot = tail.lastIndexOf('.');
    place = dot < 0 ? undefined : tail.slice(0, dot);
    parts[parts.length - 1] = dot < 0 ? tail : tail.slice(dot + 1);
  }
  const named = parts.filter((part, index) => !(index === parts.length - 1 && part === 'shown'));
  const name = named.map(words).join(' ') || key;
  return sentence(place ? `${name} for ${place}` : name);
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
    .toLowerCase();
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
