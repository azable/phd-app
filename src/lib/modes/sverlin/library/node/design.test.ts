import { describe, expect, it } from 'vitest';

import {
  boxEffects,
  caseCss,
  decorationCss,
  fillStyleCss,
  listingRegionProps,
  paintProps,
  paintReach,
  placeProps,
  propOptions,
  roleProps,
  starterLooks
} from './design';

const styleProps = ['shadow', 'glow', 'fillStyle', 'decoration', 'case'] as const;

describe('style props', () => {
  it('are props of every kind of node, not of links, starting at today’s look', () => {
    expect(propOptions.shadow).toEqual(['none', 'soft', 'lifted', 'hard']);
    expect(propOptions.glow).toEqual(['none', 'on']);
    expect(propOptions.fillStyle).toEqual(['solid', 'hatched']);
    expect(propOptions.decoration).toEqual(['none', 'underline', 'strike']);
    expect(propOptions.case).toEqual(['normal', 'uppercase', 'small-caps']);
    for (const role of ['container', 'value', 'text'] as const) {
      for (const prop of styleProps) expect(roleProps[role]).toContain(prop);
      expect(styleProps.map((prop) => starterLooks[role][prop])).toEqual([
        'none',
        'none',
        'solid',
        'none',
        'normal'
      ]);
    }
    for (const prop of styleProps) expect(roleProps.link).not.toContain(prop);
  });

  it('paint, but for case, which sizes text', () => {
    for (const prop of ['shadow', 'glow', 'fillStyle', 'decoration'])
      expect(paintProps.has(prop)).toBe(true);
    expect(paintProps.has('case')).toBe(false);
  });

  it('leave every prop that takes room to the kind, a place setting only paint and being shown', () => {
    const room = ['padding', 'textSize', 'font', 'weight', 'strokeWidth', 'minSize', 'radius'];
    for (const prop of [...room, 'gap', 'width', 'height', 'xAnchor', 'yAnchor', 'spacing'])
      expect(paintProps.has(prop)).toBe(false);
    expect([...placeProps].filter((prop) => !paintProps.has(prop))).toEqual(['shown']);
    expect(listingRegionProps.every((prop) => paintProps.has(prop))).toBe(true);
  });

  it('draw shadows and a glow round a box only, hard in its stroke or else its text colour', () => {
    const stroke = 'oklch(0.6 0.2 25)';
    const text = '#000000';
    expect(boxEffects('soft', 'none', { text })).toEqual({});
    expect(boxEffects('none', 'none', { stroke, text })).toEqual({});
    expect(boxEffects('soft', 'none', { fill: '#ffffff', text })).toEqual({
      shadow: 'soft',
      css: '0px 1px 4px rgb(0 0 0 / 0.2)'
    });
    expect(boxEffects('lifted', 'none', { fill: '#ffffff' }).css).toBe(
      '0px 4px 12px rgb(0 0 0 / 0.3)'
    );
    expect(boxEffects('hard', 'none', { stroke, text }).css).toBe(`3px 3px 0px ${stroke}`);
    expect(boxEffects('hard', 'none', { fill: '#ffffff', text }).css).toBe(`3px 3px 0px ${text}`);
    expect(boxEffects('none', 'on', { stroke, fill: '#ffffff' })).toEqual({
      glow: stroke,
      css: `0 0 8px 2px color-mix(in srgb, ${stroke} 60%, transparent)`
    });
    expect(boxEffects('hard', 'on', { fill: '#ffffff', text }).css).toBe(
      `3px 3px 0px ${text}, 0 0 8px 2px color-mix(in srgb, #ffffff 60%, transparent)`
    );
  });

  it('give a fill its style, text its line and its case', () => {
    expect(fillStyleCss('solid')).toBeUndefined();
    expect(fillStyleCss('gradient')).toBeUndefined();
    expect(fillStyleCss('hatched')?.css).toBe(
      'repeating-linear-gradient(45deg, rgb(0 0 0 / 0.15) 0 1.5px, transparent 1.5px 6px)'
    );
    expect(['none', 'underline', 'strike'].map(decorationCss)).toEqual([
      undefined,
      'underline',
      'line-through'
    ]);
    // Normal is set too, so a node's own case holds over its parent's.
    expect(caseCss('normal')).toEqual({ transform: 'none', caps: 'normal' });
    expect(caseCss('uppercase')).toEqual({ transform: 'uppercase', caps: 'normal' });
    expect(caseCss('small-caps')).toEqual({ transform: 'none', caps: 'small-caps' });
    expect(caseCss(undefined)).toBeUndefined();
  });
});

describe('paint reach', () => {
  it('reaches past a box by a shadow’s blur less its offset, and a glow’s halo', () => {
    expect(paintReach('none', 'none')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // lifted: no x offset, 4 down, blur 12.
    expect(paintReach('lifted', 'none')).toEqual({ top: 8, right: 12, bottom: 16, left: 12 });
    // hard: a block 3 right and 3 down, unblurred, reaches only those two sides.
    expect(paintReach('hard', 'none')).toEqual({ top: 0, right: 3, bottom: 3, left: 0 });
    // A glow's blur and spread on every side, the larger of each side kept.
    expect(paintReach('hard', 'on')).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });
});
