import { describe, expect, it } from 'vitest';

import { parseSheet } from './css';
import { layOut, type TextMeasure } from './layout';
import { casedRuns, caseOf, smallCapsSize } from './text-case';
import type { ModelElement } from './tree';

describe('text case', () => {
  it('uppercases text, or splits it into small capitals and the rest', () => {
    expect(casedRuns('Swap a, b', undefined)).toEqual([{ text: 'Swap a, b', small: false }]);
    expect(casedRuns('Swap a, b', 'uppercase')).toEqual([{ text: 'SWAP A, B', small: false }]);
    expect(casedRuns('Swap a1', 'small-caps')).toEqual([
      { text: 'S', small: false },
      { text: 'WAP', small: true },
      { text: ' ', small: false },
      { text: 'A', small: true },
      { text: '1', small: false }
    ]);
    // A combining mark stays with its letter.
    expect(casedRuns('é!', 'small-caps')).toEqual([
      { text: 'É', small: true },
      { text: '!', small: false }
    ]);
  });

  it('draws small capitals at 0.7 of the size in whole pixels, none left after uppercase', () => {
    expect([16, 20, 12, 17.5].map(smallCapsSize)).toEqual([11, 14, 8, 12]);
    expect(caseOf('uppercase', 'small-caps')).toBe('uppercase');
    expect(caseOf('none', 'small-caps')).toBe('small-caps');
    expect(caseOf('none', 'normal')).toBeUndefined();
  });
});

describe('the layout model', () => {
  // Each character is as wide as its font's size in pixels, so widths show the size measured at;
  // layout may measure a text more than once.
  const asked: string[] = [];
  const measure: TextMeasure = {
    width(text, font) {
      asked.push(`${text}@${font}`);
      return text.length * parseFloat(/ ([\d.]+)px/u.exec(font)?.[1] ?? '0');
    },
    metrics: () => ({ ascent: 16, descent: 4, xHeight: 8 })
  };
  const span = (style: Record<string, string>, text: string): ModelElement => ({
    tag: 'span',
    attributes: {},
    style,
    children: [text]
  });
  const widthOf = (style: Record<string, string>, text: string, sheet = '') => {
    const root: ModelElement = {
      tag: 'div',
      attributes: {},
      style: { 'font-size': '20px', 'line-height': '1.5', ...style },
      children: [span({}, text)]
    };
    return layOut(root, { rules: parseSheet(sheet), measure }).boxes.get(root.children[0] as never)
      ?.width;
  };

  it('measures text in the case its node inherits', () => {
    asked.length = 0;
    expect(widthOf({ 'text-transform': 'uppercase' }, 'ab')).toBe(40);
    expect(new Set(asked)).toEqual(new Set(['AB@normal 400 20px sans-serif']));
    asked.length = 0;
    // Ab: A at 20px, B, a small capital, at 14px.
    expect(widthOf({ 'font-variant-caps': 'small-caps' }, 'Ab')).toBe(34);
    expect(new Set(asked)).toEqual(
      new Set(['A@normal 400 20px sans-serif', 'B@normal 400 14px sans-serif'])
    );
  });

  it('lets an element set its own case over the one it inherits', () => {
    asked.length = 0;
    widthOf({ 'text-transform': 'uppercase' }, 'ab', 'span { text-transform: none; }');
    expect(new Set(asked)).toEqual(new Set(['ab@normal 400 20px sans-serif']));
  });
});
