/** Text helpers shared by browser and server. */

/**
 * The text cut to at most `max` UTF-16 units, as schema lengths count, never between the two
 * halves of a character outside the Basic Multilingual Plane (an emoji, say).
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * The value with every string in it, keys included, made storable in PostgreSQL's jsonb, which
 * refuses a lone surrogate (half an emoji) and the NUL character: lone surrogates become U+FFFD
 * and NULs are dropped.
 */
export function storableJson<T>(value: T): T {
  if (typeof value === 'string') return wellFormed(value).replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(storableJson) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [storableJson(key), storableJson(entry)])
    ) as T;
  return value;
}

function wellFormed(text: string): string {
  if (typeof text.toWellFormed === 'function') return text.toWellFormed();
  return text.replace(
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    '\ufffd'
  );
}
