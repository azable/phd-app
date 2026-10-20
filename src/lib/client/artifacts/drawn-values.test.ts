import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import type { DesignDraw } from '$lib/shared/presentations';

import { drawnMarkers, valueText } from './drawn-values';

const doc = 'const accent = pick(["red", "blue"]); const size = real(1, 2);';
const at = (text: string) => ({ start: doc.indexOf(text), end: doc.indexOf(text) + text.length });
const accent = (value: string): DesignDraw => ({
  key: 'accent',
  call: 'pick',
  args: [['red', 'blue']],
  value,
  ...at('pick(["red", "blue"])')
});
const size: DesignDraw = {
  key: 'size',
  call: 'real',
  args: [1, 2],
  value: 1.23456,
  ...at('real(1, 2)')
};

describe('drawn value markers', () => {
  it('gives each draw call the value every shown presentation drew, and whether they differ', () => {
    const state = EditorState.create({ doc });
    const markers = drawnMarkers(state, [
      { label: 'top', seed: 1, draws: [accent('red'), size] },
      { label: 'bottom', seed: 2, draws: [accent('blue'), size] }
    ]);
    expect(
      markers.map(({ from, to, differs }) => ({ text: doc.slice(from, to), differs }))
    ).toEqual([
      { text: 'pick(["red", "blue"])', differs: true },
      { text: 'real(1, 2)', differs: false }
    ]);
    expect(markers[0].values.map(({ label, text }) => `${label} ${text}`)).toEqual([
      'top "red"',
      'bottom "blue"'
    ]);
  });

  it('skips draws that do not fit the document', () => {
    const state = EditorState.create({ doc: 'const accent = 1;' });
    expect(drawnMarkers(state, [{ seed: 1, draws: [accent('red'), size] }])).toEqual([]);
  });

  it('shows each layout a tag arranged once, just past the tag, comparing forms but not seeds', () => {
    const view =
      '<Node layout="free">\n  {#each items as item}<Node layout="free">{item}</Node>{/each}\n</Node>';
    const state = EditorState.create({ doc: view });
    const outer = { line: 1, column: 1 };
    const inner = { line: 2, column: 24 };
    const markers = drawnMarkers(state, [
      {
        label: 'top',
        seed: 1,
        draws: [],
        layouts: [
          { ...outer, seed: 11, form: 'tree-down', curve: 'curved' },
          { ...inner, seed: 12, form: 'radial' },
          { ...inner, seed: 13, form: 'radial' }
        ]
      },
      {
        label: 'bottom',
        seed: 2,
        draws: [],
        layouts: [
          { ...outer, seed: 21, form: 'tree-down', curve: 'curved' },
          { ...inner, seed: 22, form: 'layers-right' }
        ]
      }
    ]);
    expect(
      markers.map(({ from, to, values, differs }) => ({
        before: view.slice(0, from).split('\n').at(-1),
        empty: from === to,
        values: values.map(({ text }) => text),
        differs
      }))
    ).toEqual([
      {
        before: '<Node layout="free">',
        empty: true,
        values: ['tree-down curved', 'tree-down curved'],
        differs: false
      },
      {
        before: '  {#each items as item}<Node layout="free">',
        empty: true,
        values: ['radial', 'layers-right'],
        differs: true
      }
    ]);
    expect(markers[1].values[0].title).toContain('12, 13');
  });

  it('shortens reals and long values', () => {
    expect(valueText(1.23456)).toBe('1.23');
    expect(valueText(3)).toBe('3');
    expect(valueText('x'.repeat(40))).toHaveLength(32);
  });
});
