/**
 * Design values as an assistant's decision writes them: one JSON string holding a nested design
 * (see nestedDesign in modes/sverlin/library/node/design-keys.ts) applied as a JSON Merge Patch
 * (RFC 7396, https://www.rfc-editor.org/rfc/rfc7396), so a value set to `null` returns to what its
 * variable inherits or follows. A string, because strict structured output cannot describe a
 * nested design's free keys; older recorded decisions carry a list of `{variable, value}`, which
 * reads as the same patch.
 */

import { baseKey, isBaseKey } from '$lib/modes/sverlin/library/node/design';
import { flatDesign } from '$lib/modes/sverlin/library/node/design-keys';
import { templateOf, templates, templateValues } from './templates/templates';
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
 * is not one object, or a value that is not a string, a number, a boolean or null. A missing or
 * empty field sets nothing. An older list of `{variable, value}` reads as it was meant.
 */
export function readDesignPatch(values: unknown): DesignPatch | { problem: string } {
  if (values === undefined || values === null || values === '') return emptyPatch;
  if (Array.isArray(values)) return listPatch(values);
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
  for (const [variable, value] of Object.entries(flatDesign(parsed as Record<string, unknown>))) {
    if (value === null) remove.push(variable);
    else if (['string', 'number', 'boolean'].includes(typeof value))
      set.push({ variable, value: value as DesignValue });
    else
      return {
        problem: `${variable} must be a string, a number, a boolean, or null to remove it, not ${JSON.stringify(value)}.`
      };
  }
  return withTemplate({ set, remove });
}

/**
 * A patch naming a template as its base, as `"...": "$textbook"`, with the template written out in
 * full under the values it sets itself, so the design holds every base value (see templates.ts).
 * A base of the model's own, named otherwise, must write some base values, and starts from
 * `$starter`'s, written out under them as a template's are, so it too holds every role's look; a
 * name that is neither, as a mistyped template's, is a problem naming the templates.
 */
function withTemplate(patch: DesignPatch): DesignPatch | { problem: string } {
  const base = patch.set.find(({ variable }) => variable === baseKey);
  if (!base) return patch;
  const template = templateOf(base.value);
  const own = patch.set.some(({ variable }) => variable !== baseKey && isBaseKey(variable));
  if (!template && !own)
    return {
      problem: `"..." names ${JSON.stringify(base.value)}, which is no template (${Object.keys(
        templates
      )
        .map((name) => `$${name}`)
        .join(
          ', '
        )}), and the values write no base of their own: name a template, or write the base's tokens, role styles ($Value, …) and scales with a name of your own.`
    };
  const written = new Set(patch.set.map(({ variable }) => variable));
  const fromTemplate = Object.entries(templateValues(template ?? 'starter'))
    .filter(([variable]) => !written.has(variable))
    .map(([variable, value]) => ({ variable, value }));
  return { set: [...fromTemplate, ...patch.set], remove: patch.remove };
}

/** A decision's patch, read once its values were checked (see readDesignPatch); unreadable throws. */
export function designPatch(values: unknown): DesignPatch {
  const patch = readDesignPatch(values);
  if ('problem' in patch) throw new Error(patch.problem);
  return patch;
}

/** A recorded decision's older list of `{variable, value}`, its malformed items left out. */
function listPatch(items: readonly unknown[]): DesignPatch {
  return {
    set: items.flatMap((item) => {
      const { variable, value } = (item ?? {}) as { variable?: unknown; value?: unknown };
      return typeof variable === 'string' && ['string', 'number', 'boolean'].includes(typeof value)
        ? [{ variable, value: value as DesignValue }]
        : [];
    }),
    remove: []
  };
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
