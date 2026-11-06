/**
 * Design keys as written and as the app keeps them. Each written mark has one meaning: `$` a token,
 * `<…>` a tag group, `{Type}` the view a type is drawn with, `:` a place, `=` a value of the data,
 * no mark a kind; `@` names only a part of the run, a label. Inside the app the variables stay flat
 * in the form variants have always stored (`views.Int@target`, `IntCell@target.stroke`,
 * `Card.stroke@true`), so stored Timelines, preferences and the option checks keep their keys; the
 * written form is what the assistant reads and writes, the guide teaches, and the developer sees:
 *
 * | Kept                                 | Written                               |
 * | ------------------------------------ | ------------------------------------- |
 * | `views.Int`                          | `{Int}`                               |
 * | `views.Int@target`                   | `{Int}:target`                        |
 * | `views.@insert.key`                  | `{@insert.key}`                       |
 * | `pointers.Index`                     | `{Index}.pointer`                     |
 * | `pointers.Index@lo`                  | `{Index}:lo`                          |
 * | `IntCell@target.stroke`              | `IntCell:target.stroke`               |
 * | `Card.stroke@true`                   | `Card=true.stroke`                    |
 * | `Card@this.seen.stroke@true`         | `Card:this.seen=true.stroke`          |
 * | `Bar.height@from` (`@hue`, …)        | `Bar.height.from` (`.hue`, …)         |
 * | `listing.syntax`                     | `listing.syntax` (or `<Listing>.syntax`) |
 *
 * `$` tokens, `$` styles' props (`$cell.stroke`), what a kind inherits (`IntCell.inherit`), `<…>`
 * groups, `listing.lit@label.…` (a label, so `@`) and frame keys are alike in both. A place's view
 * and pointer share `{Type}:place`, as a place is drawn one way or the other; where a design has
 * both, the pointer's is written `{Type}.pointer:place`. People read the written keys nested (see
 * nestedDesign).
 */

import { listingAlias } from './design';

/** The variables of an ordered bound prop (see bound.ts): its first option, hue, order and unit. */
const orderParts = new Set(['from', 'hue', 'order', 'unit']);

const kindPattern = /^[A-Z][\w$]*(?:\.[A-Z][\w$]*)*$/u;
const propPattern = /^[a-z]\w*$/u;
const plainValue = /^[\w$-]+$/u;

type KeptKey =
  | { view: 'views' | 'pointers'; type: string; place?: string }
  | { kind: string; place?: string; value?: string; part?: string; prop: string };

/** A kept key's parts, or undefined for one with no kind, place or value (a token, a group, …). */
function keptParts(key: string): KeptKey | undefined {
  const view = /^(views|pointers)\.(@[\w$.]+?|[\w$.]+?)(?:@([\w$.]+))?$/u.exec(key);
  if (view) return { view: view[1] as 'views' | 'pointers', type: view[2], place: view[3] };
  if (!/^[A-Z]/u.test(key)) return undefined;
  // A value or an ordered prop's part follows the prop: `Card.stroke@true`, `Bar.height@from`.
  let core = key;
  let suffix: string | undefined;
  const last = key.lastIndexOf('@');
  if (last > 0) {
    const before = key.slice(0, last);
    const segment = before.slice(before.lastIndexOf('.') + 1);
    if (before.includes('.') && propPattern.test(segment)) {
      core = before;
      suffix = key.slice(last + 1);
    }
  }
  const at = core.indexOf('@');
  const kind = at < 0 ? core.slice(0, core.lastIndexOf('.')) : core.slice(0, at);
  const rest = at < 0 ? core.slice(core.lastIndexOf('.') + 1) : core.slice(at + 1);
  const dot = at < 0 ? -1 : rest.lastIndexOf('.');
  if (at >= 0 && dot < 0) return undefined;
  const place = at < 0 ? undefined : rest.slice(0, dot);
  const prop = at < 0 ? rest : rest.slice(dot + 1);
  if (!kindPattern.test(kind) || !propPattern.test(prop)) return undefined;
  const ordered = suffix !== undefined && orderParts.has(suffix);
  return {
    kind,
    prop,
    ...(place ? { place } : {}),
    ...(suffix === undefined ? {} : ordered ? { part: suffix } : { value: suffix })
  };
}

/**
 * A kept key as written. `has` tells whether the design has a key, so a place drawn both ways
 * writes its pointer apart.
 */
export function writtenKey(key: string, has?: (key: string) => boolean): string {
  // A place's label (see placeLabelKey), label@lo, is written :lo.label.
  const label = /^label@([\w$.]+)$/u.exec(key);
  if (label) return `:${label[1]}.label`;
  const parts = keptParts(key);
  if (!parts) return key;
  if ('view' in parts) {
    const type = `{${parts.type}}`;
    if (parts.view === 'views') return parts.place ? `${type}:${parts.place}` : type;
    if (!parts.place) return `${type}.pointer`;
    const both = has?.(`views.${parts.type}@${parts.place}`);
    return both ? `${type}.pointer:${parts.place}` : `${type}:${parts.place}`;
  }
  const value =
    parts.value === undefined
      ? ''
      : `=${plainValue.test(parts.value) ? parts.value : JSON.stringify(parts.value)}`;
  return `${parts.kind}${parts.place ? `:${parts.place}` : ''}${value}.${parts.prop}${
    parts.part ? `.${parts.part}` : ''
  }`;
}

const writtenView = /^\{(@[\w$.]+|[A-Z][\w$.]*)\}(\.pointer)?(?::([\w$.]+))?$/u;
const writtenKind =
  /^([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)(?::([\w$.]+?))?(?:=("(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*)(?:\.(from|hue|order|unit))?$/u;

/**
 * A key as the app keeps it, from either form: the written form converted, the kept form as it is,
 * and the listing's group, `<Listing>.syntax`, as `listing.syntax`. Where `has` is given, a place's
 * view goes to the pointer where only the pointer is in the design, as `{Index}:lo` at a mark.
 */
export function keptKey(key: string, has?: (key: string) => boolean): string {
  const label = /^:([\w$.]+)\.label$/u.exec(key);
  if (label) return `label@${label[1]}`;
  const view = writtenView.exec(key);
  if (view) {
    const [, type, pointer, place] = view;
    const at = place ? `@${place}` : '';
    if (pointer) return `pointers.${type}${at}`;
    return placedView(`views.${type}${at}`, has);
  }
  if (/^[A-Z]/u.test(key) && /[:=]/u.test(key)) {
    const kind = writtenKind.exec(key);
    if (kind) {
      const [, name, place, quoted, prop, part] = kind;
      const value = quoted?.startsWith('"') ? (JSON.parse(quoted) as string) : quoted;
      return `${name}${place ? `@${place}` : ''}.${prop}${value !== undefined ? `@${value}` : ''}${
        part ? `@${part}` : ''
      }`;
    }
  }
  const ordered = /^([A-Z][\w$.]*\.[a-z]\w*)\.(from|hue|order|unit)$/u.exec(key);
  if (ordered && keptParts(ordered[1])) return `${ordered[1]}@${ordered[2]}`;
  return placedView(listingAlias(key), has);
}

/** A place's view key, moved to the pointer's where the design has only the pointer there. */
function placedView(key: string, has: ((key: string) => boolean) | undefined): string {
  if (!has || !key.startsWith('views.') || !key.includes('@', 'views.'.length + 1) || has(key))
    return key;
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
 * that is a kept key, and each kind at a place (`IntCell@target`), as `{Int}` and `IntCell:target`.
 */
export function writtenText(text: string, has?: (key: string) => boolean): string {
  return text.replace(/[\w$@.{}<>-]+/gu, (word) => {
    const end = /\.+$/u.exec(word)?.[0] ?? '';
    const key = word.slice(0, word.length - end.length);
    const written = writtenKey(key, has);
    if (written !== key) return written + end;
    const placed = /^([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)@([\w$.]+)$/u.exec(key);
    return placed ? `${placed[1]}:${placed[2]}${end}` : word;
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
    /^([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)(:[\w$.]+?)?(=(?:"(?:[^"\\]|\\.)*"|[\w$-]+))?\.([a-z]\w*(?:\.(?:from|hue|order|unit))?)$/u.exec(
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
      const key = prefix === undefined ? segment : joined(prefix, segment);
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
