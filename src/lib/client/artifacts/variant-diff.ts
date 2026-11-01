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

/** The keys whose values two variants do not share, a key only one of them sets included. */
export function differingKeys(a: DesignValues, b: DesignValues): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !(key in a && key in b && a[key] === b[key]))
    .sort((x, y) => x.localeCompare(y));
}
