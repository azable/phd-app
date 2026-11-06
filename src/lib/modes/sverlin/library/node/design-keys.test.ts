import { describe, expect, it } from 'vitest';

import {
  flatDesign,
  keptKey,
  keptValues,
  keyKind,
  keyProp,
  kindKeyParts,
  mergePatch,
  nestedDesign,
  writtenKey,
  writtenValues
} from './design-keys';

// Each view choice as kept, and as written.
const pairs: [kept: string, written: string][] = [
  ['views.Int', '{Int}'],
  ['views.Int:target', '{Int}:target'],
  ['views.Card.Name:this.name', '{Card.Name}:this.name'],
  ['views.@insert.key', '{@insert.key}'],
  ['views.@insert.key:swap.held', '{@insert.key}:swap.held'],
  ['views.Int:@scan.next', '{Int}:@scan.next']
];

// Keys alike in both forms: `:` a place, `=` a value of the data, `@` only a label.
const alike = [
  'IntCell.stroke',
  'IntCell:target.stroke',
  'LoMark.Link:lo.targetFill',
  'Mark.Link:@visit.look.check.next.targetFill',
  'VertexCard=true.padding',
  'StateMark=done.icon',
  'Card:this.seen=false.stroke',
  'Note="a b".color',
  'Bar.height.from',
  'Bar.fill.hue',
  'Bar.fill.order',
  'Bar.width.unit',
  'IntCell:target.fill.hue',
  ':lo.label',
  ':@visit.look.check.next.label',
  'Main.Problem.gap',
  '$accent',
  '<Node>.padding',
  '<Link>.stroke',
  'listing.syntax',
  'listing.lit@insert.compare.left.fill',
  'pause@main',
  'Stacked.ratio'
];

describe('design keys as written', () => {
  it.each(pairs)('writes %s as %s and keeps it back', (kept, written) => {
    expect(writtenKey(kept)).toBe(written);
    expect(keptKey(written)).toBe(kept);
  });

  it.each(alike)('leaves %s as it is', (key) => {
    expect(writtenKey(key)).toBe(key);
    expect(keptKey(key)).toBe(key);
  });

  it("names the listing's group by its settings", () => {
    expect(keptKey('<Listing>.syntax')).toBe('listing.syntax');
  });

  it('reads a kind key in its parts, a label place keeping its @', () => {
    expect(kindKeyParts('Mark.Link:@visit.look.check.next.targetFill')).toEqual({
      kind: 'Mark.Link',
      place: '@visit.look.check.next',
      prop: 'targetFill'
    });
    expect(kindKeyParts('Card:this.seen=false.stroke')).toEqual({
      kind: 'Card',
      place: 'this.seen',
      value: 'false',
      prop: 'stroke'
    });
    expect(kindKeyParts('IntCell:target.fill.hue')).toEqual({
      kind: 'IntCell',
      place: 'target',
      prop: 'fill',
      part: 'hue'
    });
    expect(keyKind('Card=true.stroke')).toBe('Card');
    expect(keyKind('IntCell:lo.fill')).toBe('IntCell:lo');
    expect(keyProp('Bar.height.from')).toBe('height');
    expect(kindKeyParts(':lo.label')).toBeUndefined();
  });

  it('converts whole variants both ways', () => {
    const kept = {
      'views.Int': 'IntCell',
      'IntCell:target.stroke': 'violet-500',
      $accent: 'teal-600'
    };
    const written = writtenValues(kept);
    expect(written).toEqual({
      '{Int}': 'IntCell',
      'IntCell:target.stroke': 'violet-500',
      $accent: 'teal-600'
    });
    expect(keptValues(written)).toEqual(kept);
  });
});

describe('the nested form', () => {
  // Each written key with its path, nested.
  const shapes: [written: string, nested: Record<string, unknown>][] = [
    ['$text', { $text: 1 }],
    ['$cell.stroke', { $cell: { stroke: 1 } }],
    ['<Node>.padding', { '<Node>': { padding: 1 } }],
    ['{Int}', { '{Int}': 1 }],
    ['{Int}:target', { '{Int}:target': 1 }],
    ['{@insert.key}', { '{@insert.key}': 1 }],
    ['listing.syntax', { listing: { syntax: 1 } }],
    ['listing.lit.fill', { listing: { lit: { fill: 1 } } }],
    [
      'listing.lit@insert.compare.left.fill',
      { listing: { lit: { '@insert.compare.left': { fill: 1 } } } }
    ],
    ['IntCell.stroke', { IntCell: { stroke: 1 } }],
    ['Here.Link.targetFill', { Here: { Link: { targetFill: 1 } } }],
    ['IntCell:target.stroke', { IntCell: { ':target': { stroke: 1 } } }],
    ['IntCell:pair.left.fill', { IntCell: { ':pair.left': { fill: 1 } } }],
    ['Mark.Link:@scan.next.targetFill', { Mark: { Link: { ':@scan.next': { targetFill: 1 } } } }],
    [':lo.label', { ':lo': { label: 1 } }],
    [':@scan.next.label', { ':@scan.next': { label: 1 } }],
    ['Card=true.stroke', { Card: { '=true': { stroke: 1 } } }],
    ['Note="a b".color', { Note: { '="a b"': { color: 1 } } }],
    ['Card:this.seen=false.stroke', { Card: { ':this.seen': { '=false': { stroke: 1 } } } }],
    ['Bar.height.from', { Bar: { 'height.from': 1 } }],
    ['IntCell:target.fill.hue', { IntCell: { ':target': { 'fill.hue': 1 } } }],
    ['IntCell.inherit', { IntCell: { '...': 1 } }],
    ['Main.Problem.gap', { Main: { Problem: { gap: 1 } } }],
    ['Stacked.ratio', { Stacked: { ratio: 1 } }],
    ['base', { '...': 1 }],
    ['scale.spacing', { scale: { spacing: 1 } }],
    ['palette.accent', { palette: { accent: 1 } }],
    ['$Value.fill', { $Value: { fill: 1 } }]
  ];

  it.each(shapes)('nests %s and reads it back', (written, nested) => {
    expect(nestedDesign({ [written]: 1 })).toEqual(nested);
    expect(flatDesign(nested)).toEqual({ [written]: 1 });
  });

  it('round-trips every kept key through the written and nested forms', () => {
    const kept = Object.fromEntries(
      [...pairs.map(([key]) => key), ...alike.filter((key) => key !== 'pause@main')].map(
        (key, i) => [key, i]
      )
    );
    expect(keptValues(flatDesign(nestedDesign(writtenValues(kept))))).toEqual(kept);
  });

  it('orders a kind: what it inherits, its props, its places, its values, its kinds', () => {
    const nested = nestedDesign({
      'Here.Link.targetFill': 1,
      'Here:lo.fill': 2,
      'Here=true.fill': 3,
      'Here.fill': 4,
      'Here.inherit': '$cell',
      '<Node>.padding': 5,
      $cell: 6
    });
    expect(Object.keys(nested)).toEqual(['$cell', '<Node>', 'Here']);
    expect(Object.keys(nested.Here as object)).toEqual(['...', 'fill', ':lo', '=true', 'Link']);
  });

  it('reads a key written flat at any level, as older documents were', () => {
    expect(flatDesign({ 'IntCell.fill': 'white', IntCell: { 'Link.targetFill': 'red-100' } })).toEqual(
      { 'IntCell.fill': 'white', 'IntCell.Link.targetFill': 'red-100' }
    );
  });

  it('keeps a null under the key or the start of keys it removes', () => {
    expect(flatDesign({ IntCell: { fill: null }, $cell: null })).toEqual({
      'IntCell.fill': null,
      $cell: null
    });
  });
});

describe('a JSON Merge Patch on a nested design', () => {
  const design = {
    $cell: { stroke: 'neutral-500', radius: 4 },
    IntCell: { '...': '$cell', fill: 'white' }
  };

  it('merges an object into the one it patches', () => {
    expect(mergePatch(design, { $cell: { radius: 8 } })).toEqual({
      $cell: { stroke: 'neutral-500', radius: 8 },
      IntCell: { '...': '$cell', fill: 'white' }
    });
  });

  it('removes a key set to null, and an object set to null with everything under it', () => {
    expect(mergePatch(design, { IntCell: { fill: null }, $cell: null })).toEqual({
      IntCell: { '...': '$cell' }
    });
  });

  it('removes nothing when the whole design is sent again', () => {
    expect(mergePatch(design, design)).toEqual(design);
  });
});
