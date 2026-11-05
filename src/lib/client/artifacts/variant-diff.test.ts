import { describe, expect, it } from 'vitest';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';

import {
  choiceEdits,
  choiceName,
  choiceRows,
  differingKeys,
  variantDocument
} from './variant-diff';

/** The rows of each document the merge view marks as changed, by the key each row sets. */
function changedKeys(a: string, b: string) {
  const docA = Text.of(a.split('\n'));
  const docB = Text.of(b.split('\n'));
  const keysIn = (doc: Text, from: number, to: number) => {
    const keys: string[] = [];
    // A chunk ends past the newline of its last row.
    for (let position = from; position < to; position = doc.lineAt(position).to + 1)
      keys.push(doc.lineAt(position).text.trim().split('"')[1]);
    return keys;
  };
  const chunks = Chunk.build(docA, docB);
  return {
    a: chunks.flatMap((chunk) => keysIn(docA, chunk.fromA, chunk.toA)),
    b: chunks.flatMap((chunk) => keysIn(docB, chunk.fromB, chunk.toB))
  };
}

const top = { 'Here.shown': true, 'Box.gap': 8, 'Arrow.style': 'curved', 'Label.size': 'small' };
const bottom = {
  'Label.size': 'large',
  'Box.gap': 8,
  'Here.shown': false,
  'Arrow.style': 'curved'
};

describe('variant diff', () => {
  it('writes every variant in one key order, one row per value', () => {
    expect(variantDocument(top).split('\n')).toEqual([
      '{',
      '  "Arrow.style": "curved",',
      '  "Box.gap": 8,',
      '  "Here.shown": true,',
      '  "Label.size": "small"',
      '}'
    ]);
  });

  it('lines up rows of values set in different orders, marking only those that differ', () => {
    expect(changedKeys(variantDocument(top), variantDocument(bottom))).toEqual({
      a: ['Here.shown', 'Label.size'],
      b: ['Here.shown', 'Label.size']
    });
    expect(differingKeys(top, bottom)).toEqual(['Here.shown', 'Label.size']);
  });

  it('marks nothing when both variants have the same values', () => {
    expect(changedKeys(variantDocument(top), variantDocument({ ...top }))).toEqual({
      a: [],
      b: []
    });
    expect(differingKeys(top, { ...top })).toEqual([]);
  });

  it('marks a value only one variant sets', () => {
    const withoutGap = Object.fromEntries(
      Object.entries(bottom).filter(([key]) => key !== 'Box.gap')
    );
    expect(changedKeys(variantDocument(top), variantDocument(withoutGap))).toEqual({
      a: ['Box.gap', 'Here.shown', 'Label.size'],
      b: ['Here.shown', 'Label.size']
    });
    expect(differingKeys(top, withoutGap)).toEqual(['Box.gap', 'Here.shown', 'Label.size']);
  });
});

describe('choices in words', () => {
  it('names a variable by its kind, prop and place', () => {
    expect(choiceName('Highlight.Pointed@pair.left.fill')).toBe(
      'Highlight pointed fill for pair.left'
    );
    expect(choiceName('IntCell@i.stroke')).toBe('Int cell stroke for i');
    expect(choiceName('Stacked.ratio')).toBe('Stacked ratio');
    expect(choiceName('views.Int@swap.held')).toBe('Int view for swap.held');
    expect(choiceName('pointers.Index')).toBe('Index pointer');
    expect(choiceName('listing.language')).toBe('Listing language');
  });

  it('gives each variant’s value as written, shown or hidden for whether something shows', () => {
    expect(choiceRows([top, bottom], differingKeys(top, bottom))).toEqual([
      { key: 'Here.shown', name: 'Here', values: ['shown', 'hidden'] },
      { key: 'Label.size', name: 'Label size', values: ['small', 'large'] }
    ]);
    expect(choiceRows([top, {}], ['Box.gap'])[0].values).toEqual(['8', 'not set']);
  });
});

describe("a developer's edit of the choices", () => {
  const shown = { 'IntCell.fill': 'white', 'IntCell.padding': 0.375, $spacing: 0.375 };

  it('keeps only the values changed or added, and lists those removed', () => {
    const edited = variantDocument({
      'IntCell.padding': 0.375,
      $spacing: 0.125,
      '<Node>.textSize': 14,
      'Goal.shown': false
    });
    expect(choiceEdits(shown, edited)).toEqual({
      chosen: { $spacing: 0.125, '<Node>.textSize': 14, 'Goal.shown': false },
      unset: ['IntCell.fill']
    });
  });

  it('changes nothing for the document as shown', () => {
    expect(choiceEdits(shown, variantDocument(shown))).toEqual({ chosen: {}, unset: [] });
  });

  it('says why text is not a document of choices', () => {
    expect(choiceEdits(shown, '{ "IntCell.fill": ')).toMatchObject({
      error: expect.stringContaining('not valid JSON')
    });
    expect(choiceEdits(shown, '[1]')).toEqual({
      error: 'The choices must be one JSON object, each variable to its value.'
    });
    expect(choiceEdits(shown, '{ "IntCell.fill": null }')).toEqual({
      error: 'IntCell.fill must be a string, a number or a boolean, not null.'
    });
  });
});
