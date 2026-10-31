import { describe, expect, it } from 'vitest';

import { cascade, parseSheet } from './css';
import { layOut, type TextMeasure } from './layout';
import { lookOf } from './look';
import type { ModelElement, ModelNode } from './tree';

/** Every character as wide as half its font's size; a font's ascent 0.8 of it, descent 0.2. */
const measure: TextMeasure = {
  width: (text, font) => text.length * (parseFloat(/([\d.]+)px/u.exec(font)?.[1] ?? '16') / 2),
  metrics: (font) => {
    const size = parseFloat(/([\d.]+)px/u.exec(font)?.[1] ?? '16');
    return { ascent: size * 0.8, descent: size * 0.2, xHeight: size / 2 };
  }
};

const element = (
  tag: string,
  attributes: Record<string, string>,
  style: Record<string, string>,
  ...children: ModelNode[]
): ModelElement => ({ tag, attributes, style, children });
const div = (style: Record<string, string>, ...children: ModelNode[]) =>
  element('div', {}, style, ...children);

const lay = (root: ModelElement, sheet = '') => layOut(root, { rules: parseSheet(sheet), measure });

describe('css', () => {
  it('cascades by specificity, then order, inline declarations over both', () => {
    const rules = parseSheet('.a { padding: 1px } div { padding: 2px } .a.b { padding: 3px }');
    const target = element('div', { class: 'a' }, {});
    expect(cascade(rules, target, []).get('padding')).toBe('1px');
    expect(cascade(rules, { ...target, attributes: { class: 'a b' } }, []).get('padding')).toBe(
      '3px'
    );
    expect(cascade(rules, { ...target, style: { padding: '4px' } }, []).get('padding')).toBe('4px');
  });

  it('matches child and descendant combinators, :not() and :where()', () => {
    const [child, descendant, not, where] = parseSheet(
      '.text > .node {} .text .node {} .label:not([placed]) {} .edge :where(.x) {}'
    );
    const node = element('div', { class: 'node' }, {});
    const text = element('div', { class: 'text' }, {});
    const between = element('div', {}, {});
    const matched = (rule: typeof child, target: ModelElement, ancestors: ModelElement[]) =>
      cascade(
        [{ ...rule, declarations: [{ property: 'x', value: '1', important: false }] }],
        target,
        ancestors
      ).has('x');
    expect(matched(child, node, [text])).toBe(true);
    expect(matched(child, node, [text, between])).toBe(false);
    expect(matched(descendant, node, [text, between])).toBe(true);
    expect(matched(not, element('div', { class: 'label' }, {}), [])).toBe(true);
    expect(matched(not, element('div', { class: 'label', placed: '' }, {}), [])).toBe(false);
    expect(
      matched(where, element('rect', { class: 'x' }, {}), [element('svg', { class: 'edge' }, {})])
    ).toBe(true);
  });

  it('refuses what it does not model, by name', () => {
    expect(() => parseSheet('.a + .b { color: red }')).toThrow(/sibling combinators/u);
    expect(() => parseSheet('.a::before { content: "" }')).toThrow(/pseudo-elements/u);
  });
});

describe('look', () => {
  const lookIn = (style: Record<string, string>, parentStyle: Record<string, string> = {}) => {
    const parent = div(parentStyle);
    const outer = lookOf(parent, [], undefined, [], 1);
    return lookOf(div(style), [parent], outer, [], 1).look;
  };

  it('resolves em against its own size, and a font size against its parent', () => {
    const look = lookIn({ 'font-size': '1.5em', padding: '0.5em 1rem' }, { 'font-size': '20px' });
    expect(look.fontSize).toBe(30);
    expect(look.padding).toEqual([15, 16, 15, 16]);
  });

  it('evaluates max() and calc() as lengths', () => {
    expect(lookIn({ 'min-width': 'max(2.5em, 51px)' }).minWidth.px).toBe(51);
    expect(lookIn({ 'min-width': 'calc(1200px - 2 * 1.5em)' }).minWidth.px).toBe(1152);
  });

  it('snaps borders to device pixels, a border under one drawing one', () => {
    const border = (width: string) =>
      lookIn({ 'border-style': 'solid', 'border-width': width }).border[0];
    expect(border('1.5px')).toBe(1);
    expect(border('0.25px')).toBe(1);
    expect(border('3px')).toBe(3);
  });

  it('takes logical margins as physical ones', () => {
    expect(lookIn({ 'margin-inline-end': 'auto' }).margin[1]).toBe('auto');
  });

  it('makes inline boxes blocks in a grid', () => {
    const grid = div({ display: 'grid' });
    const outer = lookOf(grid, [], undefined, [], 1);
    expect(lookOf(element('span', {}, {}), [grid], outer, [], 1).look.display).toBe('block');
  });
});

describe('layout', () => {
  it('stacks blocks, each as wide as the box around it', () => {
    const a = div({ height: '10px' });
    const b = div({ height: '20px' });
    const root = div({ width: '100px' }, a, b);
    const { boxes } = lay(root);
    expect(boxes.get(b)).toEqual({ x: 0, y: 10, width: 100, height: 20 });
  });

  it('places flex items by justify-content and align-items', () => {
    const a = div({ width: '10px', height: '10px' });
    const b = div({ width: '20px', height: '30px' });
    const root = div(
      {
        display: 'flex',
        'min-width': '100px',
        'justify-content': 'center',
        'align-items': 'center',
        'column-gap': '10px'
      },
      a,
      b
    );
    const { boxes } = lay(root);
    expect(boxes.get(root)).toEqual({ x: 0, y: 0, width: 100, height: 30 });
    expect(boxes.get(a)).toEqual({ x: 30, y: 10, width: 10, height: 10 });
    expect(boxes.get(b)).toEqual({ x: 50, y: 0, width: 20, height: 30 });
  });

  it('stretches a column flex item across, unless aligned', () => {
    const a = div({ height: '10px' });
    const b = div({ width: '20px', height: '10px', 'align-self': 'flex-end' });
    const root = div({ display: 'flex', 'flex-direction': 'column', width: '50px' }, a, b);
    const { boxes } = lay(root);
    expect(boxes.get(a)?.width).toBe(50);
    expect(boxes.get(b)).toEqual({ x: 30, y: 10, width: 20, height: 10 });
  });

  it('gives a collection equal tracks, each item centred in its own', () => {
    const items = [div({ width: '10px', height: '10px' }), div({ width: '30px', height: '20px' })];
    const root = div(
      {
        display: 'grid',
        'grid-auto-flow': 'column',
        'grid-auto-columns': '1fr',
        'justify-items': 'center',
        'align-items': 'center',
        'column-gap': '4px'
      },
      ...items
    );
    const { boxes } = lay(root);
    expect(boxes.get(root)?.width).toBe(64);
    expect(boxes.get(items[0])).toEqual({ x: 10, y: 5, width: 10, height: 10 });
    expect(boxes.get(items[1])).toEqual({ x: 34, y: 0, width: 30, height: 20 });
  });

  it('centres a cell value, the cell kept at its least size', () => {
    const value = element('span', {}, {}, '42');
    const cell = div(
      {
        display: 'grid',
        'place-items': 'center',
        'min-width': '40px',
        'min-height': '40px',
        'font-size': '20px',
        'line-height': '1'
      },
      value
    );
    const { boxes } = lay(cell);
    expect(boxes.get(cell)).toEqual({ x: 0, y: 0, width: 40, height: 40 });
    expect(boxes.get(value)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('sits a view in a line of text, centred on half the x-height above the baseline', () => {
    const view = div({
      display: 'inline-grid',
      'vertical-align': 'middle',
      width: '20px',
      height: '40px'
    });
    const line = div({ 'font-size': '10px', 'line-height': '20px' }, 'ab ', view, ' c');
    const { boxes } = lay(line);
    // The strut puts the baseline 13 below the top (ascent 8, leading 5); the view's middle is 2.5
    // above it, so its top is 22.5 above the baseline, which raises the line's top.
    expect(boxes.get(view)).toEqual({ x: 15, y: 0, width: 20, height: 40 });
    expect(boxes.get(line)).toEqual({ x: 0, y: 0, width: 45, height: 40 });
  });

  it('puts half the leading above the text in whole pixels', () => {
    const span = element('span', {}, {}, 'x');
    const line = div({ 'font-size': '10px', 'line-height': '15px' }, span);
    expect(lay(line).boxes.get(span)?.y).toBe(2);
  });

  it('places a box out of flow by its insets, in its positioned ancestor', () => {
    const placed = div({
      position: 'absolute',
      left: '5px',
      top: '7px',
      width: '10px',
      height: '10px'
    });
    const between = div({}, placed);
    const root = div(
      { position: 'relative', width: '100px', height: '50px', padding: '3px' },
      between
    );
    expect(lay(root).boxes.get(placed)).toEqual({ x: 5, y: 7, width: 10, height: 10 });
  });

  it('names what it does not lay out', () => {
    const root = div({ display: 'table' }, 'text');
    expect(lay(root).problems).toContain('display: table');
  });
});
