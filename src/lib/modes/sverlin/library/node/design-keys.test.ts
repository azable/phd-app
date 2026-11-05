import { describe, expect, it } from 'vitest';

import { keptKey, keptValues, writtenKey, writtenValues } from './design-keys';

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
