import { describe, expect, it } from 'vitest';

import type { LayoutMemory } from '../type-context';
import { parseSheet } from './css';
import type { TextMeasure } from './layout';
import { styler } from './look';
import { readMarkup } from './markup';
import { probeComponent, reserveSizes, withLines, type Drawing } from './reserve';
import type { ModelElement } from './tree';

/** Every character as wide as half its font's size; a font's ascent 0.8 of it, descent 0.2. */
const measure: TextMeasure = {
  width: (text, font) => text.length * (parseFloat(/([\d.]+)px/u.exec(font)?.[1] ?? '16') / 2),
  metrics: (font) => {
    const size = parseFloat(/([\d.]+)px/u.exec(font)?.[1] ?? '16');
    return { ascent: size * 0.8, descent: size * 0.2, xHeight: size / 2 };
  }
};

/** The rules of Frame, Node and Chain that lay out what these markups draw. */
const rules = parseSheet(`
  .sv-frame { display: flex; flex-direction: column; box-sizing: border-box }
  .sv-flow { display: flex; box-sizing: border-box; width: max-content }
  .sv-node { box-sizing: border-box; line-height: 1.5 }
  .cell { display: grid; place-items: center }
  .items { display: flex }
  .row { flex-direction: row }
  .uniform { display: grid }
  .uniform.row { grid-auto-flow: column; grid-auto-columns: 1fr }
`);

const frame = (content: string) =>
  readMarkup(
    `<div class="sv-frame" style="width: 800px; height: 400px; padding: 1em;"><div class="sv-root"><div class="sv-root-inner"><div class="sv-flow" style="flex-direction: column; gap: 1em;">${content}</div></div></div></div>`
  );
const cell = (id: string, text: string, extra = '') =>
  `<div class="sv-node cell" data-sv-node="${id}"${extra}><span class="value">${text}</span></div>`;
const row = (id: string, ...children: string[]) =>
  `<div class="sv-node" data-sv-node="${id}"><div class="items row">${children.join('')}</div></div>`;

const memoryOf = (): LayoutMemory => ({
  step: 0,
  recording: true,
  scopes: new Map(),
  fits: new Map(),
  reserved: new Map(),
  components: new Map(),
  lines: new Set()
});

const options = (memory: LayoutMemory) => ({
  rules,
  measure,
  styler: styler(rules, 1),
  devicePixelRatio: 1,
  ancestors: [] as ModelElement[],
  memory
});

/** Characters at 16px take 8px each; a line takes 24px. */
describe('reserveSizes', () => {
  it('keeps each node the largest size it reaches, a node holding others laid out with theirs', () => {
    const memory = memoryOf();
    const drawings: Drawing[] = [
      { step: 0, markup: frame(row('p', cell('a', '1111'), cell('b', '1'))) },
      { step: 1, markup: frame(row('p', cell('a', '1'), cell('b', '1111'))) }
    ];
    reserveSizes(drawings, options(memory));
    expect(memory.reserved.get('a')).toEqual({ width: 32, height: 24 });
    expect(memory.reserved.get('b')).toEqual({ width: 32, height: 24 });
    // Each step's row is five characters wide, but holding both cells at their largest takes eight.
    expect(memory.reserved.get('p')).toEqual({ width: 64, height: 24 });
  });

  it('gives every item of a collection the largest size any of them reaches', () => {
    const memory = memoryOf();
    const items = (...texts: string[]) =>
      `<div class="sv-node" data-sv-node="c"><div class="items row uniform" data-sv-collection="c">${texts
        .map((text, index) => cell(`c${index}`, text))
        .join('')}</div></div>`;
    reserveSizes([{ step: 0, markup: frame(items('1', '22', '333')) }], options(memory));
    for (const id of ['c0', 'c1', 'c2'])
      expect(memory.reserved.get(id)).toEqual({ width: 24, height: 24 });
  });

  it("keeps a typed component's box for its root, the nodes inside it at their own sizes", () => {
    const memory = memoryOf();
    memory.components.set('Card', { width: 100, height: 50 });
    const card = (text: string) =>
      `<div class="sv-node" data-sv-node="k" data-sv-component="Card">${cell('inner', text)}</div>`;
    const result = reserveSizes(
      [
        { step: 0, markup: frame(row('p', card('1'))) },
        { step: 1, markup: frame(row('p', card('22'))) }
      ],
      options(memory)
    );
    expect(memory.reserved.has('k')).toBe(false);
    expect(memory.reserved.has('inner')).toBe(false);
    expect(memory.reserved.get('p')).toEqual({ width: 100, height: 50 });
    // The row holds one fixed box at both steps, so it is laid out once.
    expect(result).toMatchObject({ components: 1, nodes: { node: 1 }, layouts: 1 });
  });

  it('fits each step to the frame, from its content at the sizes it keeps', () => {
    const memory = memoryOf();
    reserveSizes([{ step: 3, markup: frame(cell('a', '1'.repeat(200))) }], options(memory));
    // 1600px of text in 800px less the padding on each side.
    expect(memory.fits.get(3)).toBeCloseTo(768 / 1600);
  });
});

describe('probeComponent', () => {
  it("sizes a component by the largest of its cases, a pixel more, and finds its values' font", () => {
    const memory = memoryOf();
    const card = (text: string) =>
      `<div class="sv-node" data-sv-node="k" data-sv-component="Card">${cell('inner', text)}</div>`;
    expect(probeComponent(frame(card('1') + card('333')), 'Card', options(memory))).toEqual({
      box: { width: 25, height: 25 },
      font: 'normal 400 16px sans-serif'
    });
  });
});

describe('withLines', () => {
  it('draws a pair of links joined both ways once, undirected, the other and its label not at all', () => {
    const markup = readMarkup(
      '<div><span data-sv-link="1" data-sv-pair="L|a|b" data-sv-way="forward"></span><span data-sv-link="2" data-sv-pair="L|a|b" data-sv-way="back"></span><span data-sv-link-label="2">w</span><span data-sv-link="3" data-sv-pair="L|a|c" data-sv-way="forward"></span></div>'
    );
    const drawn = withLines(markup, new Set(['L|a|b']));
    const spans = (drawn.children[0] as ModelElement).children as ModelElement[];
    expect(spans.map((span) => span.attributes)).toEqual([
      {
        'data-sv-link': '1',
        'data-sv-pair': 'L|a|b',
        'data-sv-way': 'forward',
        'data-directed': 'false'
      },
      { 'data-sv-link': '3', 'data-sv-pair': 'L|a|c', 'data-sv-way': 'forward' }
    ]);
    expect(withLines(markup, new Set())).toBe(markup);
  });
});
