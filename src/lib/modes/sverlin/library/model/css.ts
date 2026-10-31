/**
 * The few CSS rules the library writes, read from their source: style sheets parsed into rules,
 * their selectors matched against model elements, and declarations cascaded by specificity and
 * order, inline declarations last. Only what the library's sheets use is understood: classes,
 * attributes, types, `*`, `:root`, `:not()`, `:where()`, and the descendant and child combinators.
 * Anything else is refused by name, never silently skipped.
 */

import { classesOf, type ModelElement } from './tree';

type Simple =
  | { kind: 'type'; name: string }
  | { kind: 'any' }
  | { kind: 'class'; name: string }
  | { kind: 'attribute'; name: string; value?: string }
  | { kind: 'root' }
  | { kind: 'not'; of: Selector[] }
  | { kind: 'where'; of: Selector[] }
  /** A state no layout is drawn in, as :hover: it never matches. */
  | { kind: 'state'; name: string };

type Compound = Simple[];
/** Compounds from the subject outwards, each with the combinator joining it to the next. */
type Selector = { compounds: { compound: Compound; combinator?: ' ' | '>' }[] };

export type Declaration = { property: string; value: string; important: boolean };
export type Rule = {
  selector: Selector;
  specificity: number;
  order: number;
  declarations: Declaration[];
};

/** States a step is never laid out in, whose rules never apply. */
const states = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited']);

/** Split on a character outside parentheses, brackets and quotes. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const character = text[at];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function parseDeclarations(text: string): Declaration[] {
  return splitTop(text, ';').flatMap((part) => {
    const colon = part.indexOf(':');
    if (colon < 0) return [];
    const property = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important$/iu.test(value);
    if (important) value = value.replace(/!\s*important$/iu, '').trim();
    return property && value ? [{ property, value, important }] : [];
  });
}

const identifier = /^-?[_a-zA-Z\u00a0-\uffff][-\w\u00a0-\uffff]*/u;

function parseCompound(text: string): Compound {
  const compound: Compound = [];
  let rest = text;
  const take = (pattern: RegExp) => {
    const match = pattern.exec(rest);
    if (!match) throw new Error(`Layout model: cannot read selector "${text}"`);
    rest = rest.slice(match[0].length);
    return match[0];
  };
  while (rest) {
    if (rest[0] === '*') {
      rest = rest.slice(1);
      compound.push({ kind: 'any' });
    } else if (rest[0] === '.') {
      rest = rest.slice(1);
      compound.push({ kind: 'class', name: take(identifier) });
    } else if (rest[0] === '[') {
      const body = take(/^\[[^\]]*\]/u).slice(1, -1);
      const [name, value] = body.split('=').map((part) => part.trim());
      compound.push({
        kind: 'attribute',
        name,
        ...(value === undefined ? {} : { value: value.replace(/^(['"])(.*)\1$/u, '$2') })
      });
    } else if (rest[0] === ':') {
      if (rest[1] === ':')
        throw new Error(`Layout model: pseudo-elements are not modelled ("${text}")`);
      rest = rest.slice(1);
      const name = take(identifier);
      if (rest[0] === '(') {
        let depth = 0;
        let end = 0;
        for (; end < rest.length; end++) {
          if (rest[end] === '(') depth++;
          else if (rest[end] === ')' && --depth === 0) break;
        }
        const inner = rest.slice(1, end);
        rest = rest.slice(end + 1);
        if (name === 'not' || name === 'where' || name === 'is')
          compound.push({ kind: name === 'not' ? 'not' : 'where', of: parseSelectors(inner) });
        else throw new Error(`Layout model: :${name}() is not modelled`);
      } else if (name === 'root') compound.push({ kind: 'root' });
      else if (states.has(name)) compound.push({ kind: 'state', name });
      else throw new Error(`Layout model: :${name} is not modelled`);
    } else compound.push({ kind: 'type', name: take(identifier).toLowerCase() });
  }
  return compound;
}

function parseSelector(text: string): Selector {
  const tokens = text
    .trim()
    .replace(/\s*>\s*/gu, ' > ')
    .split(/\s+/u);
  if (
    tokens.some(
      (token) =>
        token === '+' || token === '~' || /[+~]/u.test(token.replace(/\(.*\)|\[.*\]/gu, ''))
    )
  )
    throw new Error(`Layout model: sibling combinators are not modelled ("${text}")`);
  const compounds: Selector['compounds'] = [];
  let combinator: ' ' | '>' | undefined;
  for (const token of tokens.reverse()) {
    if (token === '>') {
      combinator = '>';
      continue;
    }
    if (compounds.length) compounds[compounds.length - 1].combinator = combinator ?? ' ';
    compounds.push({ compound: parseCompound(token) });
    combinator = undefined;
  }
  return { compounds };
}

function parseSelectors(text: string): Selector[] {
  return splitTop(text, ',').map(parseSelector);
}

/** Specificity as one number: ids, then classes, attributes and states, then types. */
function specificityOf(selector: Selector): number {
  const of = (simple: Simple): number => {
    switch (simple.kind) {
      case 'type':
        return 1;
      case 'class':
      case 'attribute':
      case 'root':
      case 'state':
        return 1_000;
      case 'not':
        return Math.max(...simple.of.map(specificityOf));
      default:
        return 0;
    }
  };
  return selector.compounds.reduce(
    (sum, { compound }) => sum + compound.reduce((total, simple) => total + of(simple), 0),
    0
  );
}

/** A style sheet's rules, in order; at-rules hold no layout the library writes, and are refused. */
export function parseSheet(text: string, firstOrder = 0): Rule[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules: Rule[] = [];
  let at = 0;
  let order = firstOrder;
  while (at < source.length) {
    const open = source.indexOf('{', at);
    if (open < 0) break;
    const prelude = source.slice(at, open).trim();
    const close = source.indexOf('}', open);
    if (prelude.startsWith('@')) {
      // A block holding blocks, as @keyframes, ends at its own closing brace.
      let depth = 0;
      let end = open;
      for (; end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}' && --depth === 0) break;
      }
      if (!/^@(keyframes|font-face)/u.test(prelude))
        throw new Error(`Layout model: ${prelude.split(/\s/u)[0]} is not modelled`);
      at = end + 1;
      continue;
    }
    const declarations = parseDeclarations(source.slice(open + 1, close));
    for (const selector of parseSelectors(prelude))
      rules.push({ selector, specificity: specificityOf(selector), order: order++, declarations });
    at = close + 1;
  }
  return rules;
}

function matchesCompound(
  compound: Compound,
  element: ModelElement,
  ancestors: readonly ModelElement[]
): boolean {
  return compound.every((simple) => {
    switch (simple.kind) {
      case 'any':
        return true;
      case 'type':
        return element.tag === simple.name;
      case 'class':
        return classesOf(element).includes(simple.name);
      case 'attribute':
        return simple.value === undefined
          ? simple.name in element.attributes
          : element.attributes[simple.name] === simple.value;
      case 'root':
        return ancestors.length === 0;
      case 'not':
        return !simple.of.some((selector) => matches(selector, element, ancestors));
      case 'where':
        return simple.of.some((selector) => matches(selector, element, ancestors));
      case 'state':
        return false;
    }
  });
}

/** Whether a selector matches an element, given its ancestors, the nearest last. */
export function matches(
  selector: Selector,
  element: ModelElement,
  ancestors: readonly ModelElement[]
): boolean {
  const [subject, ...outer] = selector.compounds;
  if (!matchesCompound(subject.compound, element, ancestors)) return false;
  const rest = (index: number, depth: number, combinator: ' ' | '>' | undefined): boolean => {
    if (index === outer.length) return true;
    const { compound } = outer[index];
    if (combinator === '>') {
      const parent = ancestors[depth - 1];
      return (
        !!parent &&
        matchesCompound(compound, parent, ancestors.slice(0, depth - 1)) &&
        rest(index + 1, depth - 1, outer[index].combinator)
      );
    }
    for (let at = depth - 1; at >= 0; at--)
      if (
        matchesCompound(compound, ancestors[at], ancestors.slice(0, at)) &&
        rest(index + 1, at, outer[index].combinator)
      )
        return true;
    return false;
  };
  return rest(0, ancestors.length, subject.combinator);
}

/**
 * The declarations applying to an element, by property, the cascade's winner for each: rules by
 * specificity then order, inline declarations over them, and !important over both.
 */
export function cascade(
  rules: readonly Rule[],
  element: ModelElement,
  ancestors: readonly ModelElement[]
): Map<string, string> {
  const applying = rules
    .filter((rule) => matches(rule.selector, element, ancestors))
    .toSorted((a, b) => a.specificity - b.specificity || a.order - b.order);
  const normal = new Map<string, string>();
  const important = new Map<string, string>();
  for (const { declarations } of applying)
    for (const { property, value, important: strong } of declarations)
      (strong ? important : normal).set(property, value);
  for (const [property, value] of Object.entries(element.style)) normal.set(property, value);
  for (const [property, value] of important) normal.set(property, value);
  return normal;
}
