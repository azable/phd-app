/**
 * Listing text that remembers which source node each part came from: a mark names a node by its
 * key and covers the part of the text rendered from it.
 */

export type Mark = { key: string; start: number; end: number };

export class Marked {
  constructor(
    readonly text: string,
    readonly marks: readonly Mark[] = []
  ) {}

  /** This text as rendered from the node with the given key. */
  from(key: string): Marked {
    return new Marked(this.text, [{ key, start: 0, end: this.text.length }, ...this.marks]);
  }
}

export function joined(parts: readonly (Marked | string)[], separator = ''): Marked {
  let text = '';
  const marks: Mark[] = [];
  parts.forEach((part, index) => {
    if (index > 0) text += separator;
    const piece = typeof part === 'string' ? new Marked(part) : part;
    for (const mark of piece.marks)
      marks.push({ ...mark, start: mark.start + text.length, end: mark.end + text.length });
    text += piece.text;
  });
  return new Marked(text, marks);
}

/**
 * A template with its slots filled, as 'while {test}:' with { test }: each slot's text keeps its
 * marks. A slot the template names but is not given is an error of the definition.
 */
export function filled(template: string, slots: Readonly<Record<string, Marked | string>>): Marked {
  const parts: (Marked | string)[] = [];
  let at = 0;
  for (const match of template.matchAll(/\{(\w+)\}/gu)) {
    parts.push(template.slice(at, match.index));
    const slot = slots[match[1]];
    if (slot === undefined) throw new Error(`The template "${template}" has no ${match[1]} here.`);
    parts.push(slot);
    at = match.index + match[0].length;
  }
  parts.push(template.slice(at));
  return joined(parts);
}
