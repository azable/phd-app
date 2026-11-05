/**
 * Drawings: `<Svg viewBox="0 0 24 24" height="2" label={this}>…</Svg>` in a node draws shapes the author writes,
 * as an inline SVG in the text's colour. Its size is written, never computed: the height in em of
 * the node's text, the width by the viewBox's proportions, so every value has the same room and the
 * server's layout model sizes it as the page does (an svg is sized by its own width and height).
 * What it draws may follow the view's value; only shapes are drawn, never a link or a script.
 */

/** The SVG elements a drawing may hold below its root. */
export const drawingElements = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title'
]);

/** The attributes those elements may take, each a shape's geometry or paint. */
export const drawingAttributes = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'dx',
  'dy',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline'
]);

/** Paint a drawing's shapes may take: the text's colour, so the design's colour applies, or none. */
export const drawingPaints = new Set(['currentColor', 'none']);

/** The marker the rewritten root carries, which only this rewrite writes. */
export const drawingMarker = 'data-sv-drawing';

/** A drawing's default height, in em of its node's text: about a line and a half. */
const defaultHeight = 1.5;
/** The tallest a drawing may be, in em: a card or a small figure, not a picture filling the stage. */
const maximumHeight = 12;

type Problem = { message: string; start: number };
type Edit = { start: number; length: number; text: string };

const drawingAdvice =
  'a drawing is written <Svg viewBox="0 0 24 24" height="2" label={…}>…shapes…</Svg> in a node, its viewBox and height (in em of the text) written as they are, and its label the text it stands for';

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Each `<Svg>` opening rewritten as a sized `<svg>` root in the text's colour, and each closing as
 * `</svg>`, with the problems: a size computed or missing, an unknown prop, a drawing never closed,
 * or an `<svg>` or the marker written by the author. `scanned` comes back with the tags blanked, so
 * no scan after reads them as a layout's tag.
 */
export function drawingTags(scanned: string): {
  scanned: string;
  edits: Edit[];
  problems: Problem[];
} {
  const edits: Edit[] = [];
  const problems: Problem[] = [];
  const blank = (start: number, end: number) =>
    (scanned =
      scanned.slice(0, start) +
      scanned.slice(start, end).replace(/[^\n]/gu, ' ') +
      scanned.slice(end));
  for (const match of scanned.matchAll(/<svg\b/gu))
    problems.push({
      message: `<svg> is written <Svg viewBox="…" height="…">: ${drawingAdvice}.`,
      start: match.index ?? 0
    });
  for (const match of scanned.matchAll(new RegExp(`\\b${drawingMarker}\\b`, 'gu')))
    problems.push({
      message: `${drawingMarker} is reserved for the library: ${drawingAdvice}.`,
      start: match.index ?? 0
    });
  const openings = [...scanned.matchAll(/<Svg\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>/gu)];
  const closings = [...scanned.matchAll(/<\/Svg\s*>/gu)];
  if (openings.length !== closings.length)
    problems.push({
      message: `A <Svg> is never closed, or a </Svg> closes none: ${drawingAdvice}.`,
      start: (openings[0] ?? closings[0])?.index ?? 0
    });
  for (const match of openings) {
    const start = match.index ?? 0;
    const [whole, props] = match;
    if (props.trimEnd().endsWith('/')) {
      problems.push({
        message: `<Svg /> draws nothing: write its shapes inside it, as <Svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></Svg>.`,
        start
      });
      continue;
    }
    const given = new Map<string, { text?: string; expression?: string }>();
    let rest = props;
    let problem: string | undefined;
    while (rest.trim() && !problem) {
      const prop = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/u.exec(rest);
      if (!prop) problem = `${whole.trim()} is no drawing: ${drawingAdvice}.`;
      else if (!['viewBox', 'height', 'label'].includes(prop[1]))
        problem = `A <Svg> takes only viewBox, height and label: ${prop[1]} is no prop of a drawing; paint its shapes with fill and stroke, as currentColor or none.`;
      else if (prop[4] !== undefined && prop[1] !== 'label')
        problem = `A <Svg>'s ${prop[1]} is written as it is, not computed, so every value of what it draws has the same room: write it as a number, as height="2".`;
      else {
        given.set(
          prop[1],
          prop[4] !== undefined ? { expression: prop[4] } : { text: prop[2] ?? prop[3] }
        );
        rest = rest.slice(prop[0].length);
      }
    }
    const box = given
      .get('viewBox')
      ?.text?.trim()
      .split(/[\s,]+/u)
      .map(Number);
    const height = Number(given.get('height')?.text ?? defaultHeight);
    if (!problem && (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n))))
      problem = `A <Svg> needs its viewBox, four numbers, as viewBox="0 0 24 24": it sets the drawing's proportions.`;
    else if (!problem && (!(box![2] > 0) || !(box![3] > 0)))
      problem = `A <Svg>'s viewBox has a width and a height above 0, as viewBox="0 0 24 24".`;
    if (!problem && !(height > 0 && height <= maximumHeight))
      problem = `A <Svg>'s height is a number of em above 0 and at most ${maximumHeight}, as height="2".`;
    const label = given.get('label');
    if (!problem && !label?.expression?.trim() && !label?.text?.trim())
      problem = `A <Svg> needs its label, the text it stands for, as label={this.suit}, which a screen reader reads.`;
    if (problem) {
      problems.push({ message: problem, start });
      continue;
    }
    const [, , width, tall] = box!;
    // The PDF draws the shapes, writing the label in their place only where there are none, as it
    // writes maths' text (see scene.ts).
    const { expression, text } = label!;
    const labelled =
      expression !== undefined
        ? ` aria-label={${expression}} data-sv-math-text={${expression}}`
        : ` aria-label=${JSON.stringify(text)} data-sv-math-text=${JSON.stringify(text)}`;
    edits.push({
      start,
      length: whole.length,
      text: `<svg ${drawingMarker}="" viewBox="${box!.join(' ')}" style="display: inline-block; vertical-align: middle; width: ${round((height * width) / tall)}em; height: ${round(height)}em;" fill="currentColor" role="img"${labelled}>`
    });
    blank(start, start + whole.length);
  }
  for (const [at, match] of closings.entries()) {
    const start = match.index ?? 0;
    const opening = openings[at];
    if (opening?.index !== undefined && openings.length === closings.length) {
      const body = opening.index + opening[0].length;
      if ((openings[at + 1]?.index ?? Infinity) < start)
        problems.push({
          message: `A <Svg> holds shapes, never another <Svg>: draw both in one, or each in its own node.`,
          start: openings[at + 1].index ?? 0
        });
      const shown = valueAsText(scanned.slice(body, start));
      if (shown >= 0)
        problems.push({
          message: `A drawing shows its value by the shapes it draws, never as text in them: choose its shapes with {#if}, or write the value in the node beside the drawing, as {this.rank}.`,
          start: body + shown
        });
    }
    edits.push({ start, length: match[0].length, text: '</svg>' });
    blank(start, start + match[0].length);
  }
  return { scanned, edits, problems };
}

/**
 * Where a drawing's body first writes a value as text, `{…}` outside a tag that is no block or
 * {@const}, or -1. A value in the markup draws its type's view, which is no shape; a value in a
 * shape's attribute, as r={…}, sets its geometry.
 */
function valueAsText(body: string): number {
  let inTag = false;
  let quote = '';
  for (let at = 0; at < body.length; at++) {
    const character = body[at];
    if (quote) quote = character === quote ? '' : quote;
    else if (character === '{') {
      if (!inTag && !/^\{\s*(?:[#:/]|@const\b)/u.test(body.slice(at))) return at;
      const end = body.indexOf('}', at);
      at = end < 0 ? body.length : end;
    } else if (inTag && (character === '"' || character === "'")) quote = character;
    else if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
  }
  return -1;
}

type Markup = {
  type?: string;
  name?: string;
  start?: number;
  data?: string;
  attributes?: Markup[];
  value?: true | Markup | Markup[];
  children?: Markup[];
  else?: Markup;
};

/** The parts of the markup a drawing holds besides its shapes: choices of what to draw by value. */
const drawingBlocks = new Set(['IfBlock', 'ElseBlock', 'EachBlock', 'ConstTag', 'Comment']);
/** The shapes whose content is text, written as it is, as <text>A</text>. */
const textElements = new Set(['text', 'tspan', 'title']);

/**
 * Why a drawing, a `<svg>` root this rewrite wrote (see drawingTags), draws more than shapes, with
 * where: an element no shape, an attribute neither geometry nor paint (a handler, a link, a style),
 * paint other than currentColor or none, or text outside <text>. What it draws may follow the
 * value, by {#if}, {#each} and expressions in its shapes' geometry; the viewBox clips the rest.
 */
export function drawingProblems(root: Markup): Problem[] {
  const problems: Problem[] = [];
  const refuse = (message: string, start: number | undefined) =>
    problems.push({ message, start: start ?? root.start ?? 0 });
  const check = (part: Markup, inText: boolean): void => {
    if (part.type === 'Text') {
      if (part.data?.trim() && !inText)
        refuse(
          `A drawing's words are written in a <text x="…" y="…">, as <text x="12" y="16">A</text>; or put them in the node beside the drawing.`,
          part.start
        );
      return;
    }
    if (part.type === 'Element' && drawingElements.has(part.name ?? '')) {
      for (const attribute of part.attributes ?? []) checkAttribute(part, attribute);
      for (const child of part.children ?? []) check(child, textElements.has(part.name ?? ''));
      return;
    }
    if (drawingBlocks.has(part.type ?? '')) {
      for (const child of part.children ?? []) check(child, inText);
      if (part.else) check(part.else, inText);
      return;
    }
    refuse(
      part.type === 'Element' || part.type === 'InlineComponent'
        ? `<${part.name}> is not drawn in a drawing, which holds only shapes: ${[...drawingElements].map((each) => `<${each}>`).join(', ')}.`
        : `A drawing holds only shapes, chosen by {#if} or {#each}.`,
      part.start
    );
  };
  const checkAttribute = (element: Markup, attribute: Markup) => {
    const name = attribute.name ?? '';
    if (attribute.type !== 'Attribute' || !drawingAttributes.has(name)) {
      refuse(
        attribute.type === 'Attribute'
          ? `<${element.name}> in a drawing takes no ${name}: its shapes take only geometry and paint (fill and stroke as currentColor or none), never a handler, a link or a style.`
          : `<${element.name}> in a drawing takes only geometry and paint, written as attributes, never a handler, a binding or a spread.`,
        attribute.start
      );
      return;
    }
    if (name !== 'fill' && name !== 'stroke') return;
    const parts = Array.isArray(attribute.value)
      ? attribute.value
      : [attribute.value].filter((part) => typeof part === 'object');
    if (parts.length !== 1 || parts[0].type !== 'Text' || !drawingPaints.has(parts[0].data ?? ''))
      refuse(
        `A drawing's ${name} is currentColor, the text's colour the design gives the node, or none: the design chooses the colours.`,
        attribute.start
      );
  };
  for (const child of root.children ?? []) check(child, false);
  return problems;
}
