/**
 * The Node props a presentation's seed drew for every node that leaves them unset (its recorded
 * `parameters.__defaults`, drawn by the policy in the Sverlin library's node/defaults.ts), as rows
 * that compare the visible presentations.
 *
 * @packageDocumentation
 */

import { valueText } from './drawn-values';

/** One drawn default, such as box.radius, and what each visible presentation drew for it. */
export type DrawnDefault = {
  key: string;
  values: { label?: string; text: string; color?: string }[];
  /** Whether the visible presentations drew different values. */
  differs: boolean;
};

/** Rows for the defaults of the visible presentations, by key in the order the first one drew. */
export function drawnDefaults(
  presentations: readonly { label?: string; defaults?: unknown }[]
): DrawnDefault[] {
  const rows = new Map<string, DrawnDefault & { compared: Set<string> }>();
  for (const { label, defaults } of presentations)
    for (const [key, value] of flattened(defaults)) {
      const row = rows.get(key) ?? { key, values: [], differs: false, compared: new Set<string>() };
      row.values.push({ label, ...shown(value) });
      row.compared.add(JSON.stringify(value));
      row.differs = row.compared.size > 1;
      rows.set(key, row);
    }
  return [...rows.values()].map(({ compared: _compared, ...row }) => row);
}

/** Leaf values of nested defaults by dotted key, such as ['box.radius', 'full']. */
function flattened(value: unknown, path = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return path ? [[path, value]] : [];
  return Object.entries(value).flatMap(([key, inner]) =>
    flattened(inner, path ? `${path}.${key}` : key)
  );
}

/**
 * A default as text, names unquoted; a tint's colour as a swatch, where the theme's own surface and
 * line colours read as plain.
 */
function shown(value: unknown): { text: string; color?: string } {
  if (typeof value === 'string' && value.startsWith('var(--sv-')) return { text: 'plain' };
  if (typeof value === 'string' && value.startsWith('hsl(')) return { text: value, color: value };
  return { text: typeof value === 'string' ? value : valueText(value) };
}

/** The drawn defaults one rendered node took, at its tag's line and column (both from 1). */
export type NodeDefaultsTaken = { line: number; column: number; defaults: readonly string[] };

/** One default a tag takes, such as its radius, and what each visible presentation drew for it. */
export type DefaultPill = {
  name: string;
  values: { label?: string; text: string; color?: string; title: string }[];
  differs: boolean;
};

/** The defaults a <Node> tag takes in the visible presentations, one pill per prop. */
export type TagDefaults = { line: number; column: number; pills: DefaultPill[] };

/**
 * The defaults each tag takes, joining every render of the tag. A prop is one pill whichever shape
 * it was drawn for, so a pair drawing a box and a card compares their radii; a presentation where
 * the tag does not take it shows –.
 */
export function tagDefaults(
  presentations: readonly {
    label?: string;
    defaults?: unknown;
    nodeDefaults?: readonly NodeDefaultsTaken[];
  }[]
): TagDefaults[] {
  const tags = new Map<string, { line: number; column: number; keys: Map<string, string>[] }>();
  presentations.forEach(({ nodeDefaults = [] }, index) => {
    for (const { line, column, defaults } of nodeDefaults) {
      const tag = tags.get(`${line}:${column}`) ?? {
        line,
        column,
        keys: presentations.map(() => new Map<string, string>())
      };
      for (const key of defaults) tag.keys[index].set(pillName(key), key);
      tags.set(`${line}:${column}`, tag);
    }
  });
  return [...tags.values()].map(({ line, column, keys }) => {
    const names = [...new Set(keys.flatMap((byName) => [...byName.keys()]))];
    return {
      line,
      column,
      pills: names.map((name) => {
        const values = presentations.map(({ label, defaults }, index) => {
          const key = keys[index].get(name);
          if (!key) return { label, text: '–', title: `${name} is not drawn here` };
          const value = new Map(flattened(defaults)).get(key);
          return { label, ...shown(value), title: `${key} = ${JSON.stringify(value)}` };
        });
        return { name, values, differs: new Set(values.map(({ text }) => text)).size > 1 };
      })
    };
  });
}

/** A default's prop as a view would set it: box.fill is its tint, align.row its align. */
function pillName(key: string): string {
  const prop = key.split('.').at(-1) ?? key;
  return prop === 'fill'
    ? 'tint'
    : prop === 'strokeWidth'
      ? 'stroke'
      : key.startsWith('align.')
        ? 'align'
        : prop;
}
