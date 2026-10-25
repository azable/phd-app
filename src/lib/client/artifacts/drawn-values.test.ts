import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { DesignDraw } from '$lib/shared/presentations';

import {
  drawnMarkers,
  frameProps,
  drawnValues,
  ghostRowAt,
  ghostSummary,
  leftOutNodes,
  placeGhosts,
  setDrawnValues,
  tagGhosts,
  unchosenViews,
  valueText,
  viewMarkers
} from './drawn-values';
import { setRevealed, setRevealedKeys } from './source-reveal';

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
      marked.update({
        changes: { from: 0, to: marked.doc.length, insert: '@done[let n = Int(0);]' }
      })
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
      '{#snippet IntDots(value: Int)}<Node>{value}</Node>{/snippet}',
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

    it('keeps a view a place chooses for itself', () => {
      expect(
        greyed(views, [
          {
            seed: 1,
            draws: [],
            views: options,
            variant: { ...showing('IntDots'), 'views.Int@target': 'IntTally' }
          }
        ])
      ).toEqual([{ view: 'IntCell', whole: true, title: 'Not drawn: views.Int is IntDots' }]);
    });

    it('keeps views rendered directly', () => {
      const direct = `${views}\n{@render IntTally(target)}`;
      expect(
        greyed(direct, [{ seed: 1, draws: [], views: options, variant: showing('IntDots') }])
      ).toEqual([{ view: 'IntCell', whole: true, title: 'Not drawn: views.Int is IntDots' }]);
    });

    it('greys out a node every shown presentation left out, from its tag to its closing tag', () => {
      const markup =
        '{#snippet T()}<Node>Sort</Node>{/snippet}\n{#snippet K()}<Node>key <Node>{x}</Node></Node>{/snippet}';
      const doc = EditorState.create({ doc: markup });
      const left = (presentations: Parameters<typeof leftOutNodes>[1]) =>
        leftOutNodes(doc, presentations).map(({ from, to }) => markup.slice(from, to));
      expect(
        left([
          { seed: 1, draws: [], leftOut: ['2:15', '2:25'] },
          { seed: 2, draws: [], leftOut: ['2:15'] }
        ])
      ).toEqual(['<Node>key <Node>{x}</Node></Node>']);
      // One presentation drawing it, or one that recorded nothing, greys nothing.
      expect(
        left([
          { seed: 1, draws: [], leftOut: ['2:15'] },
          { seed: 2, draws: [], leftOut: [] }
        ])
      ).toEqual([]);
      expect(
        left([
          { seed: 1, draws: [], leftOut: ['2:15'] },
          { seed: 2, draws: [] }
        ])
      ).toEqual([]);
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
    '{#snippet Here(i: Index)}\n  <Pointed />\n{/snippet}\n{#snippet Title()}<Node>Search</Node>{/snippet}';
  const variant = (fill: string) => ({
    'views.Int': 'IntCell',
    'frame.ratio': '16:9',
    'Here.Pointed.fill': fill,
    'Here.Pointed.size': 1,
    'Title.size': 1.5
  });
  const presentations = [
    {
      label: 'top',
      seed: 1,
      draws: [],
      variant: variant('amber-100'),
      origins: { 'Here.Pointed.fill': 'starter' },
      kinds: { '2:3': ['Here.Pointed'], '4:19': ['Title'] }
    },
    {
      label: 'bottom',
      seed: 2,
      draws: [],
      variant: variant('blue-100'),
      origins: { 'Here.Pointed.fill': 'random' },
      kinds: { '2:3': ['Here.Pointed'], '4:19': ['Title'] }
    }
  ];

  it('gives each tag its kind’s values in every shown variant, and whether they differ', () => {
    const ghosts = tagGhosts(EditorState.create({ doc: source }), presentations);
    expect(ghosts.map(({ kinds }) => kinds)).toEqual([['Here.Pointed'], ['Title']]);
    const [pointer, title] = ghosts;
    expect(pointer.props.map(({ name, differs }) => [name, differs])).toEqual([
      ['fill', true],
      ['size', false]
    ]);
    expect(pointer.props[0].values.map(({ text, title, color }) => [text, title, !!color])).toEqual(
      [
        ['amber-100', 'Here.Pointed.fill = amber-100, from the starter', true],
        ['blue-100', 'Here.Pointed.fill = blue-100, randomised', true]
      ]
    );
    expect(title.props.map(({ name }) => name)).toEqual(['size']);
  });

  it('gives a <Listing /> its language and fills', () => {
    const listed = `${source}\n<Listing />`;
    const withListing = presentations.map((presentation, index) => ({
      ...presentation,
      variant: {
        ...presentation.variant,
        'listing.language': index ? 'textbook' : 'code',
        'listing.current.fill': 'amber-200',
        'listing.earlier.fill': 'neutral-200'
      }
    }));
    const ghosts = tagGhosts(EditorState.create({ doc: listed }), withListing);
    const listing = ghosts.find(({ kinds }) => kinds.includes('listing'));
    expect(listing?.props.map(({ name, differs }) => [name, differs])).toEqual([
      ['language', true],
      ['current.fill', false],
      ['earlier.fill', false]
    ]);
    expect(listed.slice((listing?.at ?? 0) - '<Listing'.length, listing?.at)).toBe('<Listing');
  });

  it('leaves the page frame to no tag', () => {
    const ghosts = tagGhosts(EditorState.create({ doc: source }), presentations);
    expect(ghosts.flatMap(({ props }) => props.map(({ name }) => name))).not.toContain('ratio');
    expect(frameProps(presentations).map(({ name }) => name)).toEqual(['ratio']);
  });

  it('flashes the view marker after a render a revealed region covers', () => {
    const view = '<Node>{@render Int(a)} and {@render Int(b)}</Node>';
    const second = view.indexOf('{@render Int(b)}');
    const state = EditorState.create({ doc: view, extensions: [drawnValues] }).update({
      effects: [
        setDrawnValues.of({
          presentations: [{ ...presentations[0], variant: { 'views.Int': 'IntCell' } }]
        }),
        setRevealed.of([{ from: second, to: second + '{@render Int(b)}'.length }])
      ]
    }).state;
    // Each view marker widget, by where it sits, and whether it shows revealed.
    const revealed: [number, boolean][] = [];
    for (const set of state.facet(EditorView.decorations))
      if (typeof set !== 'function')
        set.between(0, state.doc.length, (from, to, decoration) => {
          const widget = decoration.spec.widget as { revealed?: boolean } | undefined;
          if (from === to && widget && 'revealed' in widget)
            revealed.push([from, widget.revealed!]);
        });
    expect(revealed).toEqual([
      [view.indexOf(' and'), false],
      [view.indexOf('</Node>'), true]
    ]);
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

  it('marks a render with the variable the build says it reads, a mark or a number', () => {
    const doc =
      '{#snippet At()}<Node>at {@render Index(lo)}</Node>{/snippet}\n{@render Index(@mid)}';
    const variant = { 'views.Index': 'IndexText', 'pointers.Index': 'Highlight' };
    const renders = { '1:25': 'views.Index', '2:1': 'pointers.Index' };
    const markers = viewMarkers(EditorState.create({ doc }), [
      { ...presentations[0], variant, renders }
    ]);
    expect(markers.map(({ from, to, values }) => [doc.slice(from, to), values[0].text])).toEqual([
      ['{@render Index(lo)}', 'IndexText'],
      ['{@render Index(@mid)}', 'Highlight']
    ]);
  });
});

describe('place values', () => {
  const doc = [
    '{#snippet Highlight(p: Index)}<Pointed />{/snippet}',
    '{#snippet Arrow(p: Index)}<Node layout="column"><Pointed /></Node>{/snippet}',
    '{#snippet IntCell(value: Int)}<Node {value} />{/snippet}',
    '{#snippet IndexText(p: Index)}<Node value={p} />{/snippet}',
    '{#snippet Ask(g: Greater)}<Node>{@render Int(g.a)}</Node>{/snippet}',
    '{#snippet Top()}<Node>looking at {@render Index(i)}</Node>{/snippet}',
    '{@render Index(@left)}',
    '{@render Index(@right)}',
    '{@render Int(v)}'
  ].join('\n');
  const variant = {
    'views.Int': 'IntCell',
    'views.Index': 'IndexText',
    'pointers.Index': 'Highlight',
    'pointers.Index@left': 'Highlight',
    'Highlight.Pointed.fill': 'amber-100',
    'Highlight.Pointed@left.fill': 'sky-100',
    'Highlight.Pointed@left.shown': true,
    'Arrow.Pointed@left.fill': 'amber-100',
    'IndexText@i.fill': 'sky-100',
    'IntCell@v.fill': 'white',
    'Ask.IntCell@g.a.fill': 'green-100',
    'Ask.fill': 'none'
  };
  const sites = (text: string) => {
    const at = doc.indexOf(text);
    const before = doc.slice(0, at);
    return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
  };
  const presentation = {
    seed: 1,
    draws: [],
    variant,
    views: { Int: ['IntCell'], Index: ['IndexText'] },
    pointers: { Index: ['Highlight', 'Arrow'] },
    kinds: { [sites('<Node>{@render Int(g.a)}')]: ['Ask'] },
    renders: {
      [sites('{@render Index(@left)}')]: 'pointers.Index@left',
      [sites('{@render Index(@right)}')]: 'pointers.Index',
      [sites('{@render Index(i)}')]: 'views.Index',
      [sites('{@render Int(g.a)}')]: 'views.Int',
      [sites('{@render Int(v)}')]: 'views.Int'
    }
  };
  const rows = (render: string) =>
    placeGhosts(EditorState.create({ doc }), [presentation])
      .find(({ at }) => at === doc.indexOf(render) + render.length)
      ?.props.map(({ name, key, values }) => [name, key, values[0].text]);

  it("shows a place's own view choice and the paint of the view it draws, after its render", () => {
    expect(rows('{@render Index(@left)}')).toEqual([
      ['view', 'pointers.Index@left', 'Highlight'],
      ['Highlight.Pointed.shown', 'Highlight.Pointed@left.shown', 'true'],
      ['Highlight.Pointed.fill', 'Highlight.Pointed@left.fill', 'sky-100']
    ]);
    // A render whose argument has no variables of its own is no place shown.
    expect(rows('{@render Index(@right)}')).toBeUndefined();
  });

  it('names a place in a part by its argument, and one in a typed view after the view', () => {
    expect(rows('{@render Index(i)}')).toEqual([['IndexText.fill', 'IndexText@i.fill', 'sky-100']]);
    expect(rows('{@render Int(g.a)}')).toEqual([
      ['IntCell.fill', 'Ask.IntCell@g.a.fill', 'green-100']
    ]);
    expect(rows('{@render Int(v)}')).toEqual([['IntCell.fill', 'IntCell@v.fill', 'white']]);
  });

  it("keeps a place's variables out of its kind's tag", () => {
    const tags = tagGhosts(EditorState.create({ doc }), [presentation]);
    expect(tags.flatMap(({ props }) => props.map(({ key }) => key))).toEqual(['Ask.fill']);
  });

  it('opens the ghost props holding a revealed variable and flashes its row', () => {
    const state = EditorState.create({ doc, extensions: [drawnValues] }).update({
      effects: [
        setDrawnValues.of({ presentations: [presentation] }),
        setRevealedKeys.of(['Highlight.Pointed@left.fill'])
      ]
    }).state;
    const tables: string[][] = [];
    for (const set of state.facet(EditorView.decorations))
      if (typeof set !== 'function')
        set.between(0, state.doc.length, (_from, _to, decoration) => {
          const widget = decoration.spec.widget as { revealed?: readonly string[] } | undefined;
          if (widget && Array.isArray(widget.revealed)) tables.push([...widget.revealed]);
        });
    expect(tables).toEqual([['Highlight.Pointed@left.fill']]);
    expect(ghostRowAt(state, ['Highlight.Pointed@left.fill'])).toBe(
      state.doc.lineAt(doc.indexOf('{@render Index(@left)}')).to
    );
    expect(ghostRowAt(state, ['Nothing.fill'])).toBeUndefined();
  });
});
