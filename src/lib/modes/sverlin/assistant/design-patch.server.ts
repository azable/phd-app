/**
 * Design values as an assistant's decision writes them: one JSON string holding a nested design
 * (see nestedDesign in modes/sverlin/library/node/design-keys.ts) applied as a JSON Merge Patch
 * (RFC 7396, https://www.rfc-editor.org/rfc/rfc7396), so a value set to `null` returns to what its
 * variable inherits or follows. A string, because strict structured output cannot describe a
 * nested design's free keys.
 */

import { FlatDesignError, flatDesign } from '$lib/modes/sverlin/library/node/design-keys';
import type { DesignValues } from '$lib/shared/presentations';

type DesignValue = string | number | boolean;

/** The values a patch sets and the keys it removes, as written (see design-keys.ts). */
export type DesignPatch = {
  set: { variable: string; value: DesignValue }[];
  /** Written keys, or the start of keys, as `Goal` for every value of Goal, that `null` removes. */
  remove: string[];
};

export const emptyPatch: DesignPatch = { set: [], remove: [] };

/**
 * The patch a decision's values hold, or why they cannot be read: text that is not JSON, JSON that
 * is not one object, a key written flat rather than nested (see flatDesign), or a value that is not
 * a string, a number, a boolean or null. A missing or empty field sets nothing.
 */
export function readDesignPatch(values: unknown): DesignPatch | { problem: string } {
  if (values === undefined || values === null || values === '') return emptyPatch;
  if (typeof values !== 'string')
    return { problem: 'The values must be a JSON object written as a string.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(values);
  } catch (cause) {
    return {
      problem: `The values are not valid JSON: ${(cause as Error).message}. Write one JSON object, as {"IntCell": {"fill": "sky-100"}}, or {} for none.`
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return {
      problem: `The values must be one JSON object, as {"IntCell": {"fill": "sky-100"}}, not ${JSON.stringify(parsed)}.`
    };
  const set: DesignPatch['set'] = [];
  const remove: string[] = [];
  let flat: Record<string, unknown>;
  try {
    flat = flatDesign(parsed as Record<string, unknown>);
  } catch (cause) {
    if (cause instanceof FlatDesignError) return { problem: cause.message };
    throw cause;
  }
  for (const [variable, value] of Object.entries(flat)) {
    if (value === null) remove.push(variable);
    else if (['string', 'number', 'boolean'].includes(typeof value))
      set.push({ variable, value: value as DesignValue });
    else
      return {
        problem: `${variable} must be a string, a number, a boolean, or null to remove it, not ${JSON.stringify(value)}.`
      };
  }
  return { set, remove };
}

/** A decision's patch, read once its values were checked (see readDesignPatch); unreadable throws. */
export function designPatch(values: unknown): DesignPatch {
  const patch = readDesignPatch(values);
  if ('problem' in patch) throw new Error(patch.problem);
  return patch;
}

/**
 * A variant's values without those a patch removes: each removed key in its kept form, and every
 * value under a removed start of keys, as `Goal` for `Goal.fill` and `Goal:target.stroke`.
 * `keep` turns a key as written into its kept form (keptKey).
 */
export function withoutRemoved(
  values: DesignValues | undefined,
  remove: readonly string[],
  keep: (key: string) => string,
  written: (key: string) => string
): DesignValues | undefined {
  if (!values || !remove.length) return values;
  const kept = new Set(remove.map(keep));
  const under = (key: string) =>
    remove.some((start) => /^[.:=]/u.test(key.slice(start.length)) && key.startsWith(start));
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !kept.has(key) && !under(written(key)))
  ) as DesignValues;
}
