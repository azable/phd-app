import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  drawnValues,
  ghostRowAt,
  ghostSummary,
  leftOutNodes,
  placeGhosts,
  setDrawnValues,
  tagGhosts,
  unchosenViews,
  viewMarkers
} from './drawn-values';
import { setRevealed, setRevealedKeys } from './source-reveal';

describe('drawn value markers', () => {
  it('drops the markers of renders a replaced document no longer has', () => {
    const marked = EditorState.create({
      doc: '<Node>{@render Int(target)}</Node>',
      extensions: [drawnValues]
    }).update({
      effects: setDrawnValues.of({
        presentations: [{ seed: 1, variant: { 'views.Int': 'IntCell' } }]
      })
    }).state;
    expect(() =>
      marked.update({
        changes: { from: 0, to: marked.doc.length, insert: '@done[let n = Int(0);]' }
      })
    ).not.toThrow();
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

  describe('views no presentation drew', () => {
    const views = [
      '<View of="Int" name="IntCell"><Node value={this} /></View>',
      '<View of="Int" name="IntTally"><Node layout="column"><Node value={this} /></Node></View>',
      '<View of="Int" name="IntDots"><Node>{this}</Node></View>',
      '{@render Int(target)}'
    ].join('\n');
    const options = { Int: ['IntCell', 'IntTally', 'IntDots'] };
    const showing = (view: string) => ({ 'views.Int': view });
    const greyed = (doc: string, presentations: Parameters<typeof unchosenViews>[1]) =>
      unchosenViews(EditorState.create({ doc }), presentations).map(({ from, to, title }) => ({
        view: /name="(\w+)"/u.exec(doc.slice(from, to))?.[1],
        whole: doc.slice(to - '</View>'.length, to) === '</View>',
        title
      }));

    it('greys out each view of a type no shown presentation chose', () => {
      expect(
        greyed(views, [
          { label: 'top', seed: 1, views: options, variant: showing('IntDots') },
          { label: 'bottom', seed: 2, views: options, variant: showing('IntCell') }
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
            views: options,
            variant: { ...showing('IntDots'), 'views.Int@target': 'IntTally' }
          }
        ])
      ).toEqual([{ view: 'IntCell', whole: true, title: 'Not drawn: views.Int is IntDots' }]);
    });

    it('keeps views rendered directly', () => {
      const direct = `${views}\n{@render IntTally(target)}`;
      expect(greyed(direct, [{ seed: 1, views: options, variant: showing('IntDots') }])).toEqual([
        { view: 'IntCell', whole: true, title: 'Not drawn: views.Int is IntDots' }
      ]);
    });

    it('greys out a node every shown presentation left out, from its tag to its closing tag', () => {
      const markup =
        '<Layout name="T"><Node>Sort</Node></Layout>\n<Layout name="K"><Node>key <Node>{x}</Node></Node></Layout>';
      const doc = EditorState.create({ doc: markup });
      const left = (presentations: Parameters<typeof leftOutNodes>[1]) =>
        leftOutNodes(doc, presentations).map(({ from, to }) => markup.slice(from, to));
      expect(
        left([
          { seed: 1, leftOut: ['2:18', '2:28'] },
          { seed: 2, leftOut: ['2:18'] }
        ])
      ).toEqual(['<Node>key <Node>{x}</Node></Node>']);
      // One presentation drawing it, or one that recorded nothing, greys nothing.
      expect(
        left([
          { seed: 1, leftOut: ['2:18'] },
          { seed: 2, leftOut: [] }
        ])
      ).toEqual([]);
      expect(left([{ seed: 1, leftOut: ['2:18'] }, { seed: 2 }])).toEqual([]);
    });

    it('leaves views be beside a presentation that recorded no variant', () => {
      expect(
        greyed(views, [{ seed: 1, views: options, variant: showing('IntDots') }, { seed: 2 }])
      ).toEqual([]);
    });
  });
});

describe('variant markers', () => {
  const source =
    '<View of="Index" name="Here">\n  <Pointed />\n</View>\n<Layout name="Title"><Node>Search</Node></Layout>';
  const variant = (fill: string) => ({
    'views.Int': 'IntCell',
    'Main.ratio': '16:9',
    'Here.Pointed.fill': fill,
    'Here.Pointed.textSize': 16,
    'Title.textSize': 24
  });
  const presentations = [
    {
      label: 'top',
      seed: 1,
      variant: variant('amber-100'),
      origins: { 'Here.Pointed.fill': 'starter' },
      kinds: { '2:3': ['Here.Pointed'], '4:22': ['Title'] }
    },
    {
      label: 'bottom',
      seed: 2,
      variant: variant('blue-100'),
      origins: { 'Here.Pointed.fill': 'random' },
      kinds: { '2:3': ['Here.Pointed'], '4:22': ['Title'] }
    }
  ];

  it('gives each tag its kind’s values in every shown variant, and whether they differ', () => {
    const ghosts = tagGhosts(EditorState.create({ doc: source }), presentations);
    expect(ghosts.map(({ kinds }) => kinds)).toEqual([['Here.Pointed'], ['Title']]);
    const [pointer, title] = ghosts;
    expect(pointer.props.map(({ name, differs }) => [name, differs])).toEqual([
      ['fill', true],
      ['textSize', false]
    ]);
    expect(pointer.props[0].values.map(({ text, title, color }) => [text, title, !!color])).toEqual(
      [
        ['amber-100', 'Here.Pointed.fill = amber-100, from the starter', true],
        ['blue-100', 'Here.Pointed.fill = blue-100, randomised', true]
      ]
    );
    expect(title.props.map(({ name }) => name)).toEqual(['textSize']);
  });

  it("gives a <Listing /> its language, its lit look, then its regions' paint", () => {
    const listed = `${source}\n<Listing />`;
    const withListing = presentations.map((presentation, index) => ({
      ...presentation,
      variant: {
        ...presentation.variant,
        'listing.language': index ? 'textbook' : 'code',
        'listing.lit@insert.compare.left.fill': 'sky-100',
        'listing.lit.fill': 'amber-200',
        'listing.lit.radius': 2
      }
    }));
    const ghosts = tagGhosts(EditorState.create({ doc: listed }), withListing);
    const listing = ghosts.find(({ kinds }) => kinds.includes('listing'));
    expect(listing?.props.map(({ name, differs }) => [name, differs])).toEqual([
      ['language', true],
      ['lit.fill', false],
      ['lit.radius', false],
      ['lit@insert.compare.left.fill', false]
    ]);
    expect(listed.slice((listing?.at ?? 0) - '<Listing'.length, listing?.at)).toBe('<Listing');
  });

  it('puts a layout’s frame in its root’s chip', () => {
    const laid =
      '<Layout name="Side">\n  <Node layout="row"><Title /></Node>\n</Layout>\n<Layout name="Stacked">\n  <Node><Title /></Node>\n</Layout>';
    const shown = [
      {
        seed: 1,
        variant: { 'Side.ratio': '16:9', 'Side.gap': 1, 'Stacked.ratio': '4:3' },
        kinds: { '2:3': ['Side'], '5:3': ['Stacked'] }
      }
    ];
    const state = EditorState.create({ doc: laid });
    const [side, stacked] = tagGhosts(state, shown);
    expect(side.props.map(({ name }) => name)).toEqual(['ratio', 'gap']);
    expect(stacked.props.map(({ name }) => name)).toEqual(['ratio']);
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
      '<Layout name="At"><Node>at {@render Index(lo)}</Node></Layout>\n{@render Index(@mid)}';
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
    '<View of="Index" name="Highlight"><Pointed /></View>',
    '<View of="Index" name="Arrow"><Node layout="column"><Pointed /></Node></View>',
    '<View of="Int" name="IntCell"><Node value={this} /></View>',
    '<View of="Index" name="IndexText"><Node value={this} /></View>',
    '<View of="Greater" name="Ask"><Node>{@render Int(this.a)}</Node></View>',
    '<Layout name="Top"><Node>looking at {@render Index(i)}</Node></Layout>',
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
    'Ask.IntCell@this.a.fill': 'green-100',
    'Ask.fill': 'none'
  };
  const sites = (text: string) => {
    const at = doc.indexOf(text);
    const before = doc.slice(0, at);
    return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
  };
  const presentation = {
    seed: 1,
    variant,
    views: { Int: ['IntCell'], Index: ['IndexText'] },
    pointers: { Index: ['Highlight', 'Arrow'] },
    kinds: { [sites('<Node>{@render Int(this.a)}')]: ['Ask'] },
    renders: {
      [sites('{@render Index(@left)}')]: 'pointers.Index@left',
      [sites('{@render Index(@right)}')]: 'pointers.Index',
      [sites('{@render Index(i)}')]: 'views.Index',
      [sites('{@render Int(this.a)}')]: 'views.Int',
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
    expect(rows('{@render Int(this.a)}')).toEqual([
      ['IntCell.fill', 'Ask.IntCell@this.a.fill', 'green-100']
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
