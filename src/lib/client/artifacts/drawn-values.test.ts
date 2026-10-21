import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import type { DesignDraw } from '$lib/shared/presentations';

import {
  drawnMarkers,
  frameProps,
  drawnValues,
  ghostSummary,
  setDrawnValues,
  tagGhosts,
  unchosenViews,
  valueText,
  viewMarkers
} from './drawn-values';

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

  it('says how each value came about', () => {
    const markers = drawnMarkers(EditorState.create({ doc }), [
      {
        seed: 7,
        draws: [
          { ...accent('red'), origin: 'chosen' },
          { ...size, origin: 'kept' }
        ]
      },
      { seed: 8, draws: [accent('blue'), size] }
    ]);
    expect(markers.flatMap(({ values }) => values.map(({ title }) => title))).toEqual([
      'accent = "red", chosen',
      'accent = "blue", drawn by seed 8',
      'size = 1.23456, kept from the viewed variant',
      'size = 1.23456, drawn by seed 8'
    ]);
  });

  it('drops the markers of calls a replaced document no longer has', () => {
    const marked = EditorState.create({ doc, extensions: [drawnValues] }).update({
      effects: setDrawnValues.of({ presentations: [{ seed: 1, draws: [accent('red'), size] }] })
    }).state;
    expect(() =>
      marked.update({ changes: { from: 0, to: marked.doc.length, insert: 'yield;' } })
    ).not.toThrow();
  });

  it('skips draws that do not fit the document', () => {
    const state = EditorState.create({ doc: 'const accent = 1;' });
    expect(drawnMarkers(state, [{ seed: 1, draws: [accent('red'), size] }])).toEqual([]);
  });

  it('writes a tag’s layout as ghost props before its >, pinning single values', () => {
    const view =
      '<Node layout="free">\n  {#each items as item}<Node layout="free" />{/each}\n</Node>';
    const state = EditorState.create({ doc: view });
    const outer = { line: 1, column: 1 };
    const inner = { line: 2, column: 24 };
    const ghosts = tagGhosts(state, [
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

  it('sums up a tag’s ghost props in its chip, naming those a pair drew differently', () => {
    const prop = (name: string, differs = false) => ({ name, values: [], differs });
    expect(ghostSummary([prop('radius'), prop('gap')])).toBe('2 drawn');
    expect(ghostSummary([prop('radius', true), prop('gap')])).toBe('2 drawn · radius differs');
    expect(ghostSummary(['radius', 'fill', 'stroke', 'gap'].map((name) => prop(name, true)))).toBe(
      '4 drawn · radius, fill +2 differ'
    );
    expect(ghostSummary([prop('fill', true)], ['Here[current]'])).toBe(
      'Here[current] · fill differs'
    );
    expect(ghostSummary([prop('fill')], ['Here[a]', 'Here[b]', 'Here[c]'])).toBe('Here[a] +2');
  });

  it('shortens reals and long values', () => {
    expect(valueText(1.23456)).toBe('1.23');
    expect(valueText(3)).toBe('3');
    expect(valueText('x'.repeat(40))).toHaveLength(32);
  });

  describe('views no presentation drew', () => {
    const views = [
      '{#snippet IntCell(value: Int)}<Node {value} />{/snippet}',
      '{#snippet IntTally(value: Int)}<Node layout="column"><Node {value} /></Node>{/snippet}',
      '{#snippet IntDots(value: Int)}<Node tags="dots">{value}</Node>{/snippet}',
      '{@render Int(target)}'
    ].join('\n');
    const options = { Int: ['IntCell', 'IntTally', 'IntDots'] };
    const showing = (view: string) => ({ 'views.Int': view });
    const greyed = (doc: string, presentations: Parameters<typeof unchosenViews>[1]) =>
      unchosenViews(EditorState.create({ doc }), presentations).map(({ from, to, title }) => ({
        view: /#snippet (\w+)/u.exec(doc.slice(from, to))?.[1],
        whole: doc.slice(to - '{/snippet}'.length, to) === '{/snippet}',
        title
      }));

    it('greys out each view of a type no shown presentation chose', () => {
      expect(
        greyed(views, [
          { label: 'top', seed: 1, draws: [], views: options, variant: showing('IntDots') },
          { label: 'bottom', seed: 2, draws: [], views: options, variant: showing('IntCell') }
        ])
      ).toEqual([
        { view: 'IntTally', whole: true, title: 'Not drawn: views.Int is IntDots and IntCell' }
      ]);
    });

    it('keeps views rendered directly', () => {
      const direct = `${views}\n{@render IntTally(target)}`;
      expect(
        greyed(direct, [{ seed: 1, draws: [], views: options, variant: showing('IntDots') }])
      ).toEqual([{ view: 'IntCell', whole: true, title: 'Not drawn: views.Int is IntDots' }]);
    });

    it('leaves views be beside a presentation that recorded no variant', () => {
      expect(
        greyed(views, [
          { seed: 1, draws: [], views: options, variant: showing('IntDots') },
          { seed: 2, draws: [] }
        ])
      ).toEqual([]);
    });
  });
});

describe('variant markers', () => {
  const source =
    "{#snippet Here(i: Index)}\n  <Pointed tags={['current', found && 'found']} />\n{/snippet}\n<Node tags=\"title\">Search</Node>";
  const variant = (fill: string) => ({
    'views.Int': 'IntCell',
    'frame.ratio': '16:9',
    'Here[current].fill': fill,
    'Here[current].size': 1,
    'Here[current,found].fill': 'green-100',
    'root[title].size': 1.5
  });
  const presentations = [
    {
      label: 'top',
      seed: 1,
      draws: [],
      variant: variant('amber-100'),
      origins: { 'Here[current].fill': 'starter' },
      kinds: { '2:3': ['Here[current]', 'Here[current,found]'], '4:1': ['root[title]'] }
    },
    {
      label: 'bottom',
      seed: 2,
      draws: [],
      variant: variant('blue-100'),
      origins: { 'Here[current].fill': 'random' },
      kinds: { '2:3': ['Here[current]', 'Here[current,found]'], '4:1': ['root[title]'] }
    }
  ];

  it('gives each tag its kinds’ values in every shown variant, and whether they differ', () => {
    const ghosts = tagGhosts(EditorState.create({ doc: source }), presentations);
    expect(ghosts.map(({ kinds }) => kinds)).toEqual([
      ['Here[current]', 'Here[current,found]'],
      ['root[title]', 'page']
    ]);
    const [pointer, title] = ghosts;
    expect(pointer.props.map(({ name, differs }) => [name, differs])).toEqual([
      ['Here[current].fill', true],
      ['Here[current].size', false],
      ['Here[current,found].fill', false]
    ]);
    expect(pointer.props[0].values.map(({ text, title, color }) => [text, title, !!color])).toEqual(
      [
        ['amber-100', 'Here[current].fill = amber-100, from the starter', true],
        ['blue-100', 'Here[current].fill = blue-100, randomised', true]
      ]
    );
    // A tag of one kind names its props alone, and the first top-level node holds the page.
    expect(title.props.map(({ name }) => name)).toEqual(['size', 'ratio']);
  });

  it('gives the first top-level node the page frame', () => {
    const [, title] = tagGhosts(EditorState.create({ doc: source }), presentations);
    expect(title.kinds).toEqual(['root[title]', 'page']);
    expect(title.props.map(({ name }) => name)).toEqual(['size', 'ratio']);
    expect(frameProps(presentations).map(({ name }) => name)).toEqual(['ratio']);
  });

  it('marks each render of a type with the view each shown variant draws it with', () => {
    const doc = '<Node>{@render Int(values[i + 1])} and {@render IntCell(v)}</Node>';
    const markers = viewMarkers(EditorState.create({ doc }), [
      { ...presentations[0], variant: { 'views.Int': 'IntCell' } },
      { ...presentations[1], variant: { 'views.Int': 'IntTally' } }
    ]);
    expect(
      markers.map(({ from, to, differs, values }) => [
        doc.slice(from, to),
        differs,
        values.map(({ text }) => text)
      ])
    ).toEqual([['{@render Int(values[i + 1])}', true, ['IntCell', 'IntTally']]]);
  });
});
