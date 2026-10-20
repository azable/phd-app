import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import type { DesignDraw } from '$lib/shared/presentations';

import { drawnMarkers, tagGhosts, unchosenViews, valueText } from './drawn-values';

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

  it('writes a tag’s defaults and layout as ghost props before its >, pinning single values', () => {
    const view =
      '<Node layout="free">\n  {#each items as item}<Node layout="free" />{/each}\n</Node>';
    const state = EditorState.create({ doc: view });
    const outer = { line: 1, column: 1 };
    const inner = { line: 2, column: 24 };
    const ghosts = tagGhosts(
      state,
      [
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
      ],
      [
        {
          ...outer,
          props: [{ name: 'gap', values: [{ text: 'small', title: '' }], differs: false }]
        }
      ]
    );
    expect(
      ghosts.map(({ at, props }) => ({
        before: view.slice(0, at).split('\n').at(-1),
        props: props.map(({ name, values, differs }) => ({
          name,
          texts: values.map(({ text }) => text),
          pins: values.map(({ pin }) => pin),
          differs
        }))
      }))
    ).toEqual([
      {
        before: '<Node layout="free"',
        props: [
          { name: 'gap', texts: ['small'], pins: [undefined], differs: false },
          {
            name: 'form',
            texts: ['tree-down', 'tree-down'],
            pins: ['form="tree-down"', 'form="tree-down"'],
            differs: false
          },
          {
            name: 'curve',
            texts: ['curved', 'curved'],
            pins: ['curve="curved"', 'curve="curved"'],
            differs: false
          },
          {
            name: 'layoutSeed',
            texts: ['11', '21'],
            pins: ['layoutSeed={11}', 'layoutSeed={21}'],
            differs: false
          }
        ]
      },
      {
        before: '  {#each items as item}<Node layout="free"',
        props: [
          {
            name: 'form',
            texts: ['radial', 'layers-right'],
            pins: ['form="radial"', 'form="layers-right"'],
            differs: true
          },
          {
            name: 'layoutSeed',
            texts: ['2 values', '22'],
            pins: [undefined, 'layoutSeed={22}'],
            differs: false
          }
        ]
      }
    ]);
  });

  it('shortens reals and long values', () => {
    expect(valueText(1.23456)).toBe('1.23');
    expect(valueText(3)).toBe('3');
    expect(valueText('x'.repeat(40))).toHaveLength(32);
  });

  describe('views no presentation drew', () => {
    const views = [
      '<script lang="sverlin" design>',
      '  const Int = pick([IntCell, IntCard, IntCircle]);',
      '</script>',
      '{#snippet IntCell(value: Int)}<Node {value} />{/snippet}',
      '{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}',
      '{#snippet IntCircle(value: Int)}<Node {value} radius="full" />{/snippet}',
      '{@render Int(target)}'
    ].join('\n');
    const pickInt = (value: string): DesignDraw => ({
      key: 'Int',
      call: 'pick',
      args: [['IntCell', 'IntCard', 'IntCircle']],
      value,
      start: views.indexOf('pick('),
      end: views.indexOf(');') + 1
    });
    const greyed = (doc: string, presentations: Parameters<typeof unchosenViews>[1]) =>
      unchosenViews(EditorState.create({ doc }), presentations).map(({ from, to, title }) => ({
        view: /#snippet (\w+)/u.exec(doc.slice(from, to))?.[1],
        whole: doc.slice(to - '{/snippet}'.length, to) === '{/snippet}',
        title
      }));

    it('greys out each view a pick left out of every shown presentation', () => {
      expect(
        greyed(views, [
          { label: 'top', seed: 1, draws: [pickInt('IntCircle')] },
          { label: 'bottom', seed: 2, draws: [pickInt('IntCell')] }
        ])
      ).toEqual([
        { view: 'IntCard', whole: true, title: 'Not drawn: Int picked IntCircle and IntCell' }
      ]);
    });

    it('keeps views rendered directly', () => {
      const direct = `${views}\n{@render IntCard(target)}`;
      expect(greyed(direct, [{ seed: 1, draws: [pickInt('IntCircle')] }])).toEqual([
        { view: 'IntCell', whole: true, title: 'Not drawn: Int picked IntCircle' }
      ]);
    });

    it('reads what a presentation without draws chose from its design values', () => {
      const older = { seed: 2, draws: [], parameters: { Int: 'IntCell' } };
      expect(greyed(views, [{ seed: 1, draws: [pickInt('IntCircle')] }, older])).toEqual([
        { view: 'IntCard', whole: true, title: 'Not drawn: Int picked IntCircle and IntCell' }
      ]);
      expect(
        greyed(views, [
          { seed: 1, draws: [pickInt('IntCircle')] },
          { seed: 2, draws: [] }
        ])
      ).toEqual([]);
    });
  });
});
