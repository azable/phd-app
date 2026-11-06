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
  it('writes every variant nested, in one key order, one row per value', () => {
    expect(variantDocument(top).split('\n')).toEqual([
      '{',
      '  "Arrow": {',
      '    "style": "curved"',
      '  },',
      '  "Box": {',
      '    "gap": 8',
      '  },',
      '  "Here": {',
      '    "shown": true',
      '  },',
      '  "Label": {',
      '    "size": "small"',
      '  }',
      '}'
    ]);
  });

  it('writes its keys with their marks: a type view in braces, a place after :, a value after =', () => {
    const kept = {
      'views.Int': 'IntCell',
      'IntCell:k.fill': 'red-500',
      'Card=true.fill': 'blue-100'
    };
    expect(JSON.parse(variantDocument(kept))).toEqual({
      '{Int}': 'IntCell',
      IntCell: { ':k': { fill: 'red-500' } },
      Card: { '=true': { fill: 'blue-100' } }
    });
  });

  it('lines up rows of values set in different orders, marking only those that differ', () => {
    // Each row names its prop, inside its kind's object.
    expect(changedKeys(variantDocument(top), variantDocument(bottom))).toEqual({
      a: ['shown', 'size'],
      b: ['shown', 'size']
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
    // The kind's object goes with its one value: its opening row, the value, its closing row.
    expect(changedKeys(variantDocument(top), variantDocument(withoutGap))).toEqual({
      a: ['Box', 'gap', undefined, 'shown', 'size'],
      b: ['shown', 'size']
    });
    expect(differingKeys(top, withoutGap)).toEqual(['Box.gap', 'Here.shown', 'Label.size']);
  });
});

describe('choices in words', () => {
  it('names a variable by its kind, prop and place', () => {
    expect(choiceName('Highlight.Link:pair.left.targetFill')).toBe(
      'Highlight link target fill for pair.left'
    );
    expect(choiceName('IntCell:i.stroke')).toBe('Int cell stroke for i');
    expect(choiceName('Stacked.ratio')).toBe('Stacked ratio');
    expect(choiceName('views.Int:swap.held')).toBe('Int view for swap.held');
    expect(choiceName('views.Index')).toBe('Index view');
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

  it('reads the keys as written against the variant as kept, so a renamed key is no change', () => {
    const kept = {
      'views.Int': 'IntCell',
      'views.Index:lo': 'LoMark',
      'IntCell:target.stroke': 'violet-500',
      'Card=true.stroke': 'amber-500'
    };
    expect(choiceEdits(kept, variantDocument(kept))).toEqual({ chosen: {}, unset: [] });
    const edited = JSON.parse(variantDocument(kept)) as Record<string, string>;
    edited['{Index}:lo'] = 'HiMark';
    expect(choiceEdits(kept, JSON.stringify(edited))).toEqual({
      chosen: { 'views.Index:lo': 'HiMark' },
      unset: []
    });
  });

  it('says why text is not a document of choices', () => {
    expect(choiceEdits(shown, '{ "IntCell.fill": ')).toMatchObject({
      error: expect.stringContaining('not valid JSON')
    });
    expect(choiceEdits(shown, '[1]')).toEqual({
      error: 'The choices must be one JSON object, each variable to its value.'
    });
    expect(choiceEdits(shown, '{ "IntCell": { "fill": [1] } }')).toEqual({
      error: 'IntCell.fill must be a string, a number or a boolean, not [1].'
    });
  });

  it('reads the nested document, a null removing a value as a JSON Merge Patch does', () => {
    const edited = JSON.stringify({
      $spacing: 0.375,
      $cell: { radius: 4 },
      IntCell: { '...': '$cell', fill: null, padding: 0.375 }
    });
    expect(choiceEdits(shown, edited)).toEqual({
      chosen: { '$cell.radius': 4, 'IntCell.inherit': '$cell' },
      unset: ['IntCell.fill']
    });
  });

  it('still reads an older flat document', () => {
    const flat = JSON.stringify({
      'IntCell.fill': 'blue-100',
      'IntCell.padding': 0.375,
      $spacing: 0.375
    });
    expect(choiceEdits(shown, flat)).toEqual({ chosen: { 'IntCell.fill': 'blue-100' }, unset: [] });
  });
});
