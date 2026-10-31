/**
 * A step's markup, as Svelte's string renderer writes it, read into the layout model's tree (see
 * tree.ts) without a document: the renderer writes well-formed markup, attributes quoted, so a
 * small reader does, faster than the browser's parser and reading every node back from it.
 */

import { parseDeclarations } from './css';
import type { ModelElement, ModelNode } from './tree';

const voids = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'wbr']);
const named: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

const decode = (text: string) =>
  text.includes('&')
    ? text.replace(/&(#x[\da-f]+|#\d+|\w+);/giu, (entity, name: string) =>
        name[0] === '#'
          ? String.fromCodePoint(
              name[1] === 'x' || name[1] === 'X'
                ? parseInt(name.slice(2), 16)
                : parseInt(name.slice(1), 10)
            )
          : (named[name] ?? entity)
      )
    : text;

/** Whether a character code is white space between attributes. */
const blank = (code: number) =>
  code === 32 || code === 10 || code === 9 || code === 13 || code === 12;
/** Whether a character code ends a tag's or an attribute's name. */
const ends = (code: number) => blank(code) || code === 61 || code === 62 || code === 47;

/** The elements of a markup string, under a root element given. */
export function readMarkup(
  markup: string,
  root: Pick<ModelElement, 'tag' | 'attributes'> = { tag: 'div', attributes: {} }
): ModelElement {
  const top: ModelElement & { children: ModelNode[] } = { ...root, style: {}, children: [] };
  const open: (ModelElement & { children: ModelNode[] })[] = [top];
  const length = markup.length;
  let at = 0;
  const text = (end: number) => {
    if (end > at) open[open.length - 1].children.push(decode(markup.slice(at, end)));
  };
  while (at < length) {
    const next = markup.indexOf('<', at);
    if (next < 0) break;
    text(next);
    at = next;
    const following = markup.charCodeAt(at + 1);
    if (following === 33 && markup.startsWith('<!--', at)) {
      const end = markup.indexOf('-->', at + 4);
      at = end < 0 ? length : end + 3;
      continue;
    }
    if (following === 47) {
      const end = markup.indexOf('>', at);
      const name = markup
        .slice(at + 2, end)
        .trim()
        .toLowerCase();
      // Close up to the element named, as a browser would close those left open inside it.
      const index = open.findLastIndex((element) => element.tag === name);
      if (index > 0) open.length = index;
      at = end + 1;
      continue;
    }
    // A < that opens no tag is text.
    if (!((following >= 65 && following <= 90) || (following >= 97 && following <= 122))) {
      open[open.length - 1].children.push('<');
      at++;
      continue;
    }
    let end = at + 1;
    while (end < length && !ends(markup.charCodeAt(end))) end++;
    const tag = markup.slice(at + 1, end).toLowerCase();
    at = end;
    const attributes: Record<string, string> = {};
    let style: Record<string, string> = {};
    let selfClosing = false;
    while (at < length) {
      const code = markup.charCodeAt(at);
      if (blank(code)) {
        at++;
        continue;
      }
      if (code === 62) {
        at++;
        break;
      }
      if (code === 47) {
        selfClosing = true;
        at++;
        continue;
      }
      let nameEnd = at;
      while (nameEnd < length && !ends(markup.charCodeAt(nameEnd))) nameEnd++;
      const key = markup.slice(at, nameEnd);
      at = nameEnd;
      let value = '';
      if (markup.charCodeAt(at) === 61) {
        at++;
        const quote = markup[at];
        if (quote === '"' || quote === "'") {
          const close = markup.indexOf(quote, at + 1);
          value = decode(markup.slice(at + 1, close));
          at = close + 1;
        } else {
          let valueEnd = at;
          while (
            valueEnd < length &&
            !blank(markup.charCodeAt(valueEnd)) &&
            markup[valueEnd] !== '>'
          )
            valueEnd++;
          value = decode(markup.slice(at, valueEnd));
          at = valueEnd;
        }
      }
      if (key === 'style') style = declarationsOf(value);
      else attributes[key] = value;
    }
    const element = { tag, attributes, style, children: [] as ModelNode[] };
    open[open.length - 1].children.push(element);
    if (!selfClosing && !voids.has(tag)) open.push(element);
  }
  text(length);
  return top;
}

/**
 * A style attribute's declarations, by property. Svelte writes them plainly, so a semicolon ends
 * each unless a quote, a url() or !important asks for the full reading.
 */
function declarationsOf(text: string): Record<string, string> {
  const style: Record<string, string> = {};
  if (/["'!]|url\(/u.test(text)) {
    for (const { property, value } of parseDeclarations(text)) style[property] = value;
    return style;
  }
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (property && value) style[property] = value;
  }
  return style;
}
