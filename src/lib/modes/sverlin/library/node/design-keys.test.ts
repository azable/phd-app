import { describe, expect, it } from 'vitest';

import {
  flatDesign,
  keptKey,
  keptValues,
  mergePatch,
  nestedDesign,
  writtenKey,
  writtenValues
} from './design-keys';

// Each kept key, as variants have always stored it, and its written form.
const pairs: [kept: string, written: string][] = [
  ['views.Int', '{Int}'],
  ['views.Int@target', '{Int}:target'],
  ['views.Card.Name@this.name', '{Card.Name}:this.name'],
  ['views.@insert.key', '{@insert.key}'],
  ['views.@insert.key@swap.held', '{@insert.key}:swap.held'],
  ['pointers.Index', '{Index}.pointer'],
  ['IntCell@target.stroke', 'IntCell:target.stroke'],
  ['LoMark.Pointed@lo.fill', 'LoMark.Pointed:lo.fill'],
  ['Highlight.Pointed@insert.swap.from.fill', 'Highlight.Pointed:insert.swap.from.fill'],
  ['VertexCard.padding@true', 'VertexCard=true.padding'],
  ['StateMark.icon@done', 'StateMark=done.icon'],
  ['Card@this.seen.stroke@false', 'Card:this.seen=false.stroke'],
  ['Note.color@a b', 'Note="a b".color'],
  ['Bar.height@from', 'Bar.height.from'],
  ['Bar.fill@hue', 'Bar.fill.hue'],
  ['Bar.fill@order', 'Bar.fill.order'],
  ['Bar.width@unit', 'Bar.width.unit'],
  ['IntCell@target.fill@hue', 'IntCell:target.fill.hue']
];

// Keys alike in both forms.
const alike = [
  'IntCell.stroke',
  'Main.Problem.gap',
  '$accent',
  '<Node>.padding',
  '<Pointed>.stroke',
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

  it('keeps a kept key as it is, so old variants and requests still load', () => {
    for (const [kept] of pairs) expect(keptKey(kept)).toBe(kept);
  });

  it("names the listing's group by its settings", () => {
    expect(keptKey('<Listing>.syntax')).toBe('listing.syntax');
  });

  it("sends a place's view to the pointer where the design has only the pointer there", () => {
    const design = new Set(['pointers.Index@lo', 'views.Index@k']);
    const has = (key: string) => design.has(key);
    expect(keptKey('{Index}:lo', has)).toBe('pointers.Index@lo');
    expect(keptKey('{Index}:k', has)).toBe('views.Index@k');
    expect(keptKey('views.Index@lo', has)).toBe('pointers.Index@lo');
  });

  it('writes the pointer apart where a place is drawn both ways', () => {
    const design = new Set(['pointers.Index@lo', 'views.Index@lo']);
    const has = (key: string) => design.has(key);
    expect(writtenKey('pointers.Index@lo', has)).toBe('{Index}.pointer:lo');
    expect(writtenKey('views.Index@lo', has)).toBe('{Index}:lo');
    expect(keptKey('{Index}.pointer:lo', has)).toBe('pointers.Index@lo');
    expect(keptKey('{Index}:lo', has)).toBe('views.Index@lo');
  });

  it('converts whole variants both ways', () => {
    const kept = {
      'views.Int': 'IntCell',
      'IntCell@target.stroke': 'violet-500',
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
    ['{Index}.pointer', { '{Index}.pointer': 1 }],
    ['{Index}.pointer:lo', { '{Index}.pointer:lo': 1 }],
    ['{@insert.key}', { '{@insert.key}': 1 }],
    ['listing.syntax', { listing: { syntax: 1 } }],
    ['listing.lit.fill', { listing: { lit: { fill: 1 } } }],
    [
      'listing.lit@insert.compare.left.fill',
      { listing: { lit: { '@insert.compare.left': { fill: 1 } } } }
    ],
    ['IntCell.stroke', { IntCell: { stroke: 1 } }],
    ['Here.Pointed.fill', { Here: { Pointed: { fill: 1 } } }],
    ['IntCell:target.stroke', { IntCell: { ':target': { stroke: 1 } } }],
    ['IntCell:pair.left.fill', { IntCell: { ':pair.left': { fill: 1 } } }],
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
      'Here.Pointed.fill': 1,
      'Here:lo.fill': 2,
      'Here=true.fill': 3,
      'Here.fill': 4,
      'Here.inherit': '$cell',
      '<Node>.padding': 5,
      $cell: 6
    });
    expect(Object.keys(nested)).toEqual(['$cell', '<Node>', 'Here']);
    expect(Object.keys(nested.Here as object)).toEqual(['...', 'fill', ':lo', '=true', 'Pointed']);
  });

  it('reads a key written flat at any level, as older documents were', () => {
    expect(flatDesign({ 'IntCell.fill': 'white', IntCell: { 'Pointed.fill': 'red-100' } })).toEqual(
      { 'IntCell.fill': 'white', 'IntCell.Pointed.fill': 'red-100' }
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
