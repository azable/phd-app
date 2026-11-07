/**
 * Design keys as written, which is also how the app keeps them. Each mark has one meaning: `$` a
 * token or a style, `<…>` a built-in name (a role's style, as `<Value>`, and the listing, `<Listing>`), `{Type}` the view a type is drawn with, `:` a place on the page, `=`
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
 *
 * Every other key reads the same in both: `IntCell:target.stroke`, `Mark.<Link>.<To>:@scan.next.fill`,
 * `Card=true.stroke`, `Card:this.seen=true.stroke`, `Bar.height.from` (`.hue`, `.order`,
 * `.unit`), a place's caption `:target.label` (`:@scan.next.label`), `$` tokens and styles,
 * `<Value>.fill`, `<Listing>.lit@insert.key.fill` and `<Listing>.syntax`. People read the keys
 * nested (see nestedDesign).
 */

import { placeCaption, templateKey } from './design';

/** A place as kept and written: a variable or field (`lo`, `pair.left`), or a label (`@scan.next`). */
const placePattern = String.raw`@?[\w$.]+?`;
const viewKey = new RegExp(String.raw`^views\.(@[\w$.]+?|[\w$.]+?)(?::(${placePattern}))?$`, 'u');
const writtenView = new RegExp(
  String.raw`^\{(@[\w$.]+|[A-Z][\w$.]*)\}(?::(${placePattern}))?$`,
  'u'
);
/** A kind's key: kind, place, value, prop and an ordered prop's part (see bound.ts). */
const kindKey = new RegExp(
  String.raw`^([A-Z][\w$]*(?:\.(?:[A-Z][\w$]*|<Link>|<To>|<From>))*)(?::(${placePattern}))?(?:=("(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*)(?:\.(from|hue|order|unit))?$`,
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

/** A kept key as written: a view choice in braces, every other key as it is. */
export function writtenKey(key: string): string {
  const view = viewKey.exec(key);
  if (!view) return key;
  const [, type, place] = view;
  return place ? `{${type}}:${place}` : `{${type}}`;
}

/** A key as the app keeps it: a view choice from braces, every other key as it is. */
export function keptKey(key: string): string {
  const view = writtenView.exec(key);
  if (!view) return key;
  const [, type, place] = view;
  return `views.${type}${place ? `:${place}` : ''}`;
}

/** A variant's values with their keys as written. */
export function writtenValues<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [writtenKey(key), value]));
}

/**
 * A message's kept keys as written, as a build's refusal names them for the assistant: each word
 * that is a view choice, as `views.Int` written `{Int}`.
 */
export function writtenText(text: string): string {
  return text.replace(/[\w$@:.{}<>-]+/gu, (word) => {
    const end = /\.+$/u.exec(word)?.[0] ?? '';
    const key = word.slice(0, word.length - end.length);
    const written = writtenKey(key);
    return written !== key ? written + end : word;
  });
}

/** A variant's values with their keys as the app keeps them. */
export function keptValues<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [keptKey(key), value]));
}

/**
 * A design as people and the assistant read it: nested, one object for each style, role style,
 * kind and the listing, as the language guide's Shared values shows. Each written key's path:
 *
 * | Written                        | Nested                                        |
 * | ------------------------------ | --------------------------------------------- |
 * | `$text`                        | `"$text": …`                                  |
 * | `$cell.stroke`                 | `"$cell": { "stroke": … }`                    |
 * | `<Value>.padding`              | `"<Value>": { "padding": … }`                 |
 * | `{Int}`, `{Int}:target`, …     | `"{Int}": …`, `"{Int}:target": …` (whole)     |
 * | `<Listing>.lit.fill`           | `"<Listing>": { "lit": { "fill": … } }`       |
 * | `<Listing>.lit@insert.key.fill`| `… "lit": { "@insert.key": { "fill": … } }`   |
 * | `Here.<Link>.<To>.fill`        | `"Here": { "<Link>": { "<To>": { "fill": … } } }` |
 * | `IntCell:target.stroke`        | `"IntCell": { ":target": { "stroke": … } }`   |
 * | `Card=true.stroke`             | `"Card": { "=true": { "stroke": … } }`        |
 * | `Card:this.seen=true.stroke`   | `"Card": { ":this.seen": { "=true": … } }`    |
 * | `Bar.height.from`              | `"Bar": { "height.from": … }`                 |
 * | `IntCell.inherit`              | `"IntCell": { "...": … }`                     |
 * | `template`                     | `"template": "$textbook"` (a request's only)  |
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
  const caption = placeCaption.exec(key);
  if (caption) return [`:${caption[1]}`, 'label'];
  const ofBase = /^(scale|palette)\.([a-z]\w*)$/u.exec(key);
  if (ofBase) return [ofBase[1], ofBase[2]];
  if (key.startsWith('<Listing>.')) {
    const rest = key.slice('<Listing>.'.length);
    const at = rest.indexOf('@');
    if (at < 0) return ['<Listing>', ...rest.split('.')];
    const label = rest.slice(at + 1, rest.lastIndexOf('.'));
    return [
      '<Listing>',
      ...rest.slice(0, at).split('.'),
      `@${label}`,
      rest.slice(rest.lastIndexOf('.') + 1)
    ];
  }
  const prefixed = /^(\$[\w$]+|<[A-Za-z]+>)\.(.+)$/u.exec(key);
  if (prefixed) return [prefixed[1], ...prefixed[2].split('.')];
  const kind =
    /^([A-Z][\w$]*(?:\.(?:[A-Z][\w$]*|<Link>|<To>|<From>))*)(:@?[\w$.]+?)?(=(?:"(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*(?:\.(?:from|hue|order|unit))?)$/u.exec(
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
  if (key.startsWith('<') && !['<Listing>', '<Link>', '<To>', '<From>'].includes(key)) return 2;
  if (key.startsWith('{')) return 3;
  if (key === '<Listing>') return 4;
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

/** A design written otherwise than nested, one level for each part of a key (see flatDesign). */
export class FlatDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlatDesignError';
  }
}

/**
 * Why a segment of a nested design is no one level of it, or undefined: two parts joined by a dot,
 * as `"IntCell.fill"` or `"scale.spacing"`, where a place (`":@scan.next"`), a value
 * (`"=a.b"`), a listing region (`"@insert.key"`), a view choice (`"{Int}:target"`) or an ordered
 * prop's part (`"fill.hue"`) may hold dots; `inherit`, written `"..."`; and a base at the top,
 * `"..."` or `"base"`, which a design no longer has: it is a copy of a template.
 */
function notNested(prefix: string | undefined, segment: string): string | undefined {
  const under = prefix === undefined ? 'at the top' : `under ${prefix}`;
  if (segment === 'inherit' && prefix !== undefined)
    return `"inherit" ${under} is written "...", as {"${prefix.split('.')[0]}": {"...": "$cell"}}.`;
  if ((segment === 'base' || segment === '...') && prefix === undefined)
    return `"${segment}" at the top named a base the design followed, which is gone: a design is a copy of a template, named in the first version as {"${templateKey}": "$starter"}, and later versions change the copy.`;
  if (/^[:=@{]/u.test(segment) || !segment.includes('.') || segment === '...') return undefined;
  if (/^[a-z]\w*\.(?:from|hue|order|unit)$/u.test(segment)) return undefined;
  const [first, ...rest] = segment.split('.');
  return `"${segment}" ${under} is written flat: a design is written nested, each part of a key a level of its own, as {"${first}": {"${rest.join('": {"')}": …}}.`;
}

/**
 * A nested design's written keys, each with its value: the path joined back into a key (see
 * nestedDesign), `"..."` as the kind's `inherit`. A design written otherwise, a key flat at any
 * level or `inherit` for `"..."`, is a FlatDesignError naming the nested form. A `null`, as a JSON
 * Merge Patch writes it to remove a value, is kept under the key or the start of keys it removes.
 */
export function flatDesign(design: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const problems: string[] = [];
  const walk = (prefix: string | undefined, object: Readonly<Record<string, unknown>>) => {
    for (const [segment, value] of Object.entries(object)) {
      const problem = notNested(prefix, segment);
      if (problem) {
        problems.push(problem);
        continue;
      }
      // `"..."` under a kind names what it inherits.
      const key = prefix === undefined ? segment : joined(prefix, segment);
      if (value && typeof value === 'object' && !Array.isArray(value))
        walk(key, value as Record<string, unknown>);
      else flat[key] = value;
    }
  };
  walk(undefined, design);
  if (problems.length) throw new FlatDesignError(problems.join(' '));
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
