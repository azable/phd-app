/**
 * Design keys as written, which is also how the app keeps them. Each mark has one meaning: `$` a
 * token, `<…>` a tag group, `{Type}` the view a type is drawn with, `:` a place on the page, `=`
 * a value of the data, no mark a kind; `@` only a part of the run, a label, as a label marks a
 * moment or span of it. A place drawn from a label's value keeps the label's `@` after its `:`.
 * Only a view choice is kept apart from how it is written, as a choice holds a view's name rather
 * than props:
 *
 * | Kept                          | Written                       |
 * | ----------------------------- | ----------------------------- |
 * | `views.Int`                   | `{Int}`                       |
 * | `views.Int:target`            | `{Int}:target`                |
 * | `views.@insert.key`           | `{@insert.key}`               |
 * | `pointers.Index`              | `{Index}.pointer`             |
 * | `pointers.Index:@scan.next`   | `{Index}:@scan.next`          |
 *
 * Every other key reads the same in both: `IntCell:target.stroke`, `Mark.Pointed:@scan.next.fill`,
 * `Card=true.stroke`, `Card:this.seen=true.stroke`, `Bar.height.from` (`.hue`, `.order`,
 * `.unit`), a place's caption `:target.label` (`:@scan.next.label`), `$` tokens and styles,
 * `<…>` groups, `listing.lit@insert.key.fill` and `listing.syntax` (or `<Listing>.syntax`). A
 * place's view and pointer share `{Type}:place`, as a place is drawn one way or the other; where a
 * design has both, the pointer's is written `{Type}.pointer:place`. People read the keys nested
 * (see nestedDesign).
 */

import { baseKey, listingAlias, placeCaption } from './design';

/** A place as kept and written: a variable or field (`lo`, `pair.left`), or a label (`@scan.next`). */
const placePattern = String.raw`@?[\w$.]+?`;
const viewKey = new RegExp(
  String.raw`^(views|pointers)\.(@[\w$.]+?|[\w$.]+?)(?::(${placePattern}))?$`,
  'u'
);
const writtenView = new RegExp(
  String.raw`^\{(@[\w$.]+|[A-Z][\w$.]*)\}(\.pointer)?(?::(${placePattern}))?$`,
  'u'
);
/** A kind's key: kind, place, value, prop and an ordered prop's part (see bound.ts). */
const kindKey = new RegExp(
  String.raw`^([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)(?::(${placePattern}))?(?:=("(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*)(?:\.(from|hue|order|unit))?$`,
  'u'
);
const plainValue = /^[\w$-]+$/u;

/** A kind's key in its parts, or undefined for any other key (a token, a group, a view choice, …). */
export function kindKeyParts(
  key: string
): { kind: string; place?: string; value?: string; prop: string; part?: string } | undefined {
  const parts = kindKey.exec(key);
  if (!parts) return undefined;
  const [, kind, place, quoted, prop, part] = parts;
  const value = quoted?.startsWith('"') ? (JSON.parse(quoted) as string) : quoted;
  return {
    kind,
    prop,
    ...(place ? { place } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(part ? { part } : {})
  };
}

/** A kind's key at a value of the data, `Card=true.stroke` (see bound.ts). */
export const valueKeyOf = (kind: string, prop: string, value: string): string =>
  `${kind}=${plainValue.test(value) ? value : JSON.stringify(value)}.${prop}`;

/**
 * The kind a variable sets, with its place but not its value: `IntCell:lo` for `IntCell:lo.fill`,
 * `Card` for `Card=true.stroke`, `Bar` for `Bar.height.from`; any other key up to its last dot.
 */
export function keyKind(key: string): string {
  const parts = kindKeyParts(key);
  if (parts) return parts.place ? `${parts.kind}:${parts.place}` : parts.kind;
  return key.slice(0, Math.max(0, key.lastIndexOf('.')));
}

/** The prop a variable sets: `fill` for `IntCell:lo.fill` and `Card=true.fill`, `height` for `Bar.height.from`. */
export function keyProp(key: string): string {
  return kindKeyParts(key)?.prop ?? key.slice(key.lastIndexOf('.') + 1);
}

/** Whether a variable sets a kind's own prop: no place, value or ordered part, as `IntCell.fill`. */
export const isOwnOfKind = (key: string): boolean => {
  const parts = kindKeyParts(key);
  return !!parts && !parts.place && parts.value === undefined && !parts.part;
};

/** Whether a variable is set for a place or a value of the data rather than its whole kind. */
export const isPlacedOrValued = (key: string): boolean => {
  const parts = kindKeyParts(key);
  return parts ? parts.place !== undefined || parts.value !== undefined : false;
};

/**
 * A kept key as written: a view choice in braces, every other key as it is. `has` tells whether
 * the design has a key, so a place drawn both ways writes its pointer apart.
 */
export function writtenKey(key: string, has?: (key: string) => boolean): string {
  const view = viewKey.exec(key);
  if (!view) return key;
  const [, choice, type, place] = view;
  const braced = `{${type}}`;
  if (choice === 'views') return place ? `${braced}:${place}` : braced;
  if (!place) return `${braced}.pointer`;
  const both = has?.(`views.${type}:${place}`);
  return both ? `${braced}.pointer:${place}` : `${braced}:${place}`;
}

/**
 * A key as the app keeps it: a view choice from braces, the listing's group, `<Listing>.syntax`, as
 * `listing.syntax`, every other key as it is. Where `has` is given, a place's view goes to the
 * pointer where only the pointer is in the design, as `{Index}:lo` at a mark.
 */
export function keptKey(key: string, has?: (key: string) => boolean): string {
  const view = writtenView.exec(key);
  if (view) {
    const [, type, pointer, place] = view;
    const at = place ? `:${place}` : '';
    if (pointer) return `pointers.${type}${at}`;
    return placedView(`views.${type}${at}`, has);
  }
  return placedView(listingAlias(key), has);
}

/** A place's view key, moved to the pointer's where the design has only the pointer there. */
function placedView(key: string, has: ((key: string) => boolean) | undefined): string {
  if (!has || !key.startsWith('views.') || !viewKey.exec(key)?.[3] || has(key)) return key;
  const pointer = `pointers.${key.slice('views.'.length)}`;
  return has(pointer) ? pointer : key;
}

/** A variant's values with their keys as written. */
export function writtenValues<T>(
  values: Readonly<Record<string, T>>,
  has: (key: string) => boolean = (key) => Object.hasOwn(values, key)
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [writtenKey(key, has), value])
  );
}

/**
 * A message's kept keys as written, as a build's refusal names them for the assistant: each word
 * that is a view choice, as `views.Int` written `{Int}`.
 */
export function writtenText(text: string, has?: (key: string) => boolean): string {
  return text.replace(/[\w$@:.{}<>-]+/gu, (word) => {
    const end = /\.+$/u.exec(word)?.[0] ?? '';
    const key = word.slice(0, word.length - end.length);
    const written = writtenKey(key, has);
    return written !== key ? written + end : word;
  });
}

/** A variant's values with their keys as the app keeps them. */
export function keptValues<T>(
  values: Readonly<Record<string, T>>,
  has?: (key: string) => boolean
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [keptKey(key, has), value])
  );
}

/**
 * A design as people and the assistant read it: nested, one object for each token style, group,
 * kind and listing, as the language guide's Shared values shows. Each written key's path:
 *
 * | Written                        | Nested                                        |
 * | ------------------------------ | --------------------------------------------- |
 * | `$text`                        | `"$text": …`                                  |
 * | `$cell.stroke`                 | `"$cell": { "stroke": … }`                    |
 * | `<Node>.padding`               | `"<Node>": { "padding": … }`                  |
 * | `{Int}`, `{Int}:target`, …     | `"{Int}": …`, `"{Int}:target": …` (whole)     |
 * | `listing.lit.fill`             | `"listing": { "lit": { "fill": … } }`         |
 * | `listing.lit@insert.key.fill`  | `… "lit": { "@insert.key": { "fill": … } }`   |
 * | `Here.Pointed.fill`            | `"Here": { "Pointed": { "fill": … } }`        |
 * | `IntCell:target.stroke`        | `"IntCell": { ":target": { "stroke": … } }`   |
 * | `Card=true.stroke`             | `"Card": { "=true": { "stroke": … } }`        |
 * | `Card:this.seen=true.stroke`   | `"Card": { ":this.seen": { "=true": … } }`    |
 * | `Bar.height.from`              | `"Bar": { "height.from": … }`                 |
 * | `IntCell.inherit`              | `"IntCell": { "...": … }`                     |
 * | `base`                         | `"...": "$textbook"` (at the top)             |
 * | `scale.spacing`                | `"scale": { "spacing": … }`                   |
 * | `palette.accent`               | `"palette": { "accent": … }`                  |
 *
 * A view choice stays one key, as it holds a view's name rather than props. Props start with a
 * lowercase letter, kinds with a capital, a place with `:`, a value with `=` and a label with `@`,
 * so every path reads back to one key (see flatDesign).
 */
export function nestedDesign<T>(values: Readonly<Record<string, T>>): NestedDesign<T> {
  const nested: NestedDesign<T> = {};
  for (const [key, value] of Object.entries(values)) {
    const path = pathOf(key);
    let at = nested;
    for (const segment of path.slice(0, -1)) {
      const next = at[segment];
      at = (next && typeof next === 'object' ? next : (at[segment] = {})) as NestedDesign<T>;
    }
    at[path.at(-1)!] = value;
  }
  return sortedDesign(nested);
}

/** A nested design: each key's value, or an object of the keys under it. */
export type NestedDesign<T> = { [key: string]: T | NestedDesign<T> };

/** A written key's path in the nested form (see nestedDesign). */
function pathOf(key: string): string[] {
  if (key.startsWith('{')) return [key];
  if (key === baseKey) return ['...'];
  const caption = placeCaption.exec(key);
  if (caption) return [`:${caption[1]}`, 'label'];
  const ofBase = /^(scale|palette)\.([a-z]\w*)$/u.exec(key);
  if (ofBase) return [ofBase[1], ofBase[2]];
  const prefixed = /^(\$[\w$]+|<[A-Za-z]+>)\.(.+)$/u.exec(key);
  if (prefixed) return [prefixed[1], prefixed[2]];
  if (key.startsWith('listing.')) {
    const rest = key.slice('listing.'.length);
    const at = rest.indexOf('@');
    if (at < 0) return ['listing', ...rest.split('.')];
    const label = rest.slice(at + 1, rest.lastIndexOf('.'));
    return [
      'listing',
      ...rest.slice(0, at).split('.'),
      `@${label}`,
      rest.slice(rest.lastIndexOf('.') + 1)
    ];
  }
  const kind =
    /^([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)(:@?[\w$.]+?)?(=(?:"(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*(?:\.(?:from|hue|order|unit))?)$/u.exec(
      key
    );
  if (!kind) return [key];
  const [, name, place, value, prop] = kind;
  return [
    ...name.split('.'),
    ...(place ? [place] : []),
    ...(value ? [value] : []),
    prop === 'inherit' ? '...' : prop
  ];
}

/** The order a nested object's keys are shown in: inherited, tokens, groups, views, the listing, props, places, values, kinds. */
function rank(key: string): number {
  if (key === '...') return 0;
  if (key.startsWith('$')) return 1;
  if (key.startsWith('<')) return 2;
  if (key.startsWith('{')) return 3;
  if (key === 'listing') return 4;
  if (/^[a-z]/u.test(key)) return 5;
  if (key.startsWith(':')) return 6;
  if (key.startsWith('=')) return 7;
  if (key.startsWith('@')) return 8;
  return 9;
}

function sortedDesign<T>(design: NestedDesign<T>): NestedDesign<T> {
  return Object.fromEntries(
    Object.entries(design)
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? sortedDesign(value as NestedDesign<T>)
          : value
      ])
  );
}

/**
 * A nested design's written keys, each with its value: the path joined back into a key (see
 * nestedDesign), `"..."` as the kind's `inherit`. A key already written flat at any level, as an
 * older `"IntCell.fill": "white"`, is joined as it is, so either form reads. A `null`, as a JSON
 * Merge Patch writes it to remove a value, is kept under the key or the start of keys it removes.
 */
export function flatDesign(design: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const walk = (prefix: string | undefined, object: Readonly<Record<string, unknown>>) => {
    for (const [segment, value] of Object.entries(object)) {
      // `"..."` at the top names the design's base (see baseKey); under a kind, what it inherits.
      const top = segment === '...' ? baseKey : segment;
      const key = prefix === undefined ? top : joined(prefix, segment);
      if (value && typeof value === 'object' && !Array.isArray(value))
        walk(key, value as Record<string, unknown>);
      else flat[key] = value;
    }
  };
  walk(undefined, design);
  return flat;
}

function joined(prefix: string, segment: string): string {
  if (segment === '...') return `${prefix}.inherit`;
  return /^[:=@]/u.test(segment) ? `${prefix}${segment}` : `${prefix}.${segment}`;
}

/**
 * A JSON Merge Patch (RFC 7396, https://www.rfc-editor.org/rfc/rfc7396) applied to a nested
 * design: an object merges into the one it patches, `null` removes a key, and any other value
 * replaces it; so a whole design sent by mistake removes nothing.
 */
export function mergePatch(
  target: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (typeof value === 'object' && !Array.isArray(value)) {
      const under = merged[key];
      merged[key] = mergePatch(
        under && typeof under === 'object' && !Array.isArray(under)
          ? (under as Record<string, unknown>)
          : {},
        value as Record<string, unknown>
      );
    } else merged[key] = value;
  }
  return merged;
}
