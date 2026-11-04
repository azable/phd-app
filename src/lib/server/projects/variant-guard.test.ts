import { describe, expect, it } from 'vitest';

import { resampledVariants } from '$lib/modes/sverlin/chooser-decisions.server';
import type { ProjectEvent } from '$lib/shared/projects/events';

// A resample of a linear search the Decisions API answered wanting to hide most of the picture:
// Board (all of it) 0.67, Answer 0.70, EqualityQuestion 0.68, the listing 0.93.
import recorded from './fixtures/decisions-hides-most.json';
import {
  allowedChange,
  allowedComparisonSide,
  guardedChoice,
  hiddenShare,
  hides,
  mootComparison,
  pictureTree,
  settledValues
} from './variant-guard';

const tree = pictureTree(recorded.source);
const context = { tree, base: recorded.variant, settled: {} };
const asked = recorded.answers.map(({ name }) => ({
  variable: name,
  value: (recorded.variant as Record<string, string | number | boolean>)[name],
  options: (recorded.options as Record<string, (string | number | boolean)[]>)[name]
}));

describe('pictureTree', () => {
  it('reads what the root draws and what each layout draws by its tag', () => {
    expect(tree.root).toEqual(['Board']);
    expect(tree.snippets.get('Board')).toEqual(['<Listing>', 'SearchView']);
    expect(tree.snippets.get('SearchView')).toContain('Answer');
  });

  it('measures the picture by every page layout, never hiding a layout’s own nodes', () => {
    const laid = pictureTree(`<Layout name="Title"><Node>t</Node></Layout>
<Layout name="Cells"><Node>c</Node></Layout>
<Layout name="Note"><Node>n</Node></Layout>
<Layout name="Board"><Node><Cells /><Note /></Node></Layout>
<Layout name="Stacked"><Node><Title /><Board /></Node></Layout>
<Layout name="Bare"><Node layout="row"><Node><Board /></Node></Node></Layout>`);
    expect(laid.layouts.get('Stacked')).toEqual(['Title', 'Board']);
    expect(laid.layouts.get('Bare')).toEqual(['Board']);
    // Hiding the title hides one of the seven nodes the two pages draw, the stacked page's.
    expect(hiddenShare(laid, {}, [['Title.shown', false]])).toBeCloseTo(1 / 7);
    const guard = { tree: laid, base: {}, settled: {} };
    expect(allowedChange(guard, 'Bare.shown', false)).toBe(false);
  });

  it('reads the kinds a view’s nodes name as what it draws', () => {
    const viewed =
      pictureTree(`<View of="Values" name="Row"><Node><Node kind="Under">i</Node></Node></View>
<Layout name="Shown" of="values"><Node>{values}</Node></Layout>
<Layout name="Main" of="values"><Node><Shown values={values} /></Node></Layout>`);
    expect(viewed.snippets.get('Row')).toEqual(['Under']);
    expect(viewed.layouts.get('Main')).toEqual(['Shown']);
    expect([...viewed.layouts.keys()]).toEqual(['Main']);
  });
});

describe('allowedChange', () => {
  it('never hides a top-level part or a node holding most of the picture', () => {
    expect(allowedChange(context, 'Board.shown', false)).toBe(false);
    expect(allowedChange(context, 'SearchView.shown', false)).toBe(false);
  });

  it('lets a small part or the listing go', () => {
    expect(allowedChange(context, 'FoundCaption.shown', false)).toBe(true);
    expect(allowedChange(context, 'listing.language', 'none')).toBe(true);
  });

  it('never changes a settled value', () => {
    const settled = { ...context, settled: { 'listing.language': 'textbook' } };
    expect(allowedChange(settled, 'listing.language', 'none')).toBe(false);
  });

  it('measures how much of the picture a change hides', () => {
    expect(hiddenShare(tree, recorded.variant, [['Board.shown', false]])).toBeGreaterThan(0.85);
    expect(hiddenShare(tree, recorded.variant, [['FoundCaption.shown', false]])).toBeLessThan(0.15);
  });
});

describe('allowedComparisonSide', () => {
  const page = pictureTree(`<Layout name="Title"><Node>t</Node></Layout>
<Layout name="Note"><Node>n</Node></Layout>
<Layout name="Cells"><Node>c</Node></Layout>
<Layout name="Board"><Node><Cells /><Note /></Node></Layout>
<Layout name="Stacked"><Node><Title /><Board /></Node></Layout>`);
  const guard = { tree: page, base: {}, settled: {} };

  it('lets the assistant compare a top-level title with and without, which a chooser may not hide', () => {
    expect(allowedComparisonSide(guard, { 'Title.shown': false })).toBe(true);
    expect(allowedChange(guard, 'Title.shown', false)).toBe(false);
    expect(guardedChoice(guard, { chosen: { 'Title.shown': false } }).chosen).toEqual({});
  });

  it('never hides the layout itself or most of the picture, however many things', () => {
    expect(allowedComparisonSide(guard, { 'Stacked.shown': false })).toBe(false);
    expect(allowedComparisonSide(guard, { 'Board.shown': false })).toBe(false);
    expect(allowedComparisonSide(guard, { 'Title.shown': false, 'Note.shown': false })).toBe(false);
    expect(
      allowedComparisonSide(context, {
        'FoundCaption.shown': false,
        'listing.language': 'textbook'
      })
    ).toBe(true);
  });
});

describe('guardedChoice', () => {
  it('keeps at most one hide, and never one not allowed', () => {
    const { chosen } = guardedChoice(context, {
      chosen: {
        'Board.shown': false,
        'listing.language': 'none',
        'Answer.shown': false,
        'views.Int': 'IntTally'
      }
    });
    expect(chosen).toEqual({ 'listing.language': 'none', 'views.Int': 'IntTally' });
  });
});

describe('the Decisions chooser on the recorded answers', () => {
  it('changes visible choices without hiding more than one thing, or anything large', () => {
    const { variants } = resampledVariants(asked, 1, recorded, recorded.seen, (variable, value) =>
      allowedChange(context, variable, value)
    );
    const [values] = variants.map((variant) => variant.values);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter(({ variable, value }) => hides(variable, value)).length).toBeLessThan(2);
    expect(values.map(({ variable }) => variable)).not.toContain('Board.shown');
    expect(
      hiddenShare(
        tree,
        recorded.variant,
        values.map(({ variable, value }) => [variable, value])
      )
    ).toBeLessThan(0.5);
  });
});

describe('settledValues', () => {
  let id = 0;
  const presented = (presentationId: string, variant: Record<string, string>) =>
    ({
      id: ++id,
      type: 'visualization.presented',
      payload: { presentation: { format: 'browser-bundle-v1', presentationId, variant } }
    }) as unknown as ProjectEvent;
  const preferred = (presentations: [string, string], winner: string) =>
    ({
      id: ++id,
      type: 'visualization.preference-recorded',
      payload: { presentations, preferred: winner }
    }) as unknown as ProjectEvent;
  const vary = (variable: string, value: string) =>
    ({
      id: ++id,
      type: 'ai.generation-succeeded',
      payload: {
        response: {
          text: JSON.stringify({
            output_text: JSON.stringify({
              decision: { action: 'vary', values: [{ variable, value }], randomise: [] }
            })
          })
        }
      }
    }) as unknown as ProjectEvent;

  it('settles a choice once one option is very likely best over two answers, and what a vary decision set', () => {
    const textbook = { 'listing.language': 'textbook', 'Cell.fill': 'white' };
    const none = { 'listing.language': 'none', 'Cell.fill': 'white' };
    const once = [presented('a', textbook), presented('b', none), preferred(['a', 'b'], 'a')];
    // One answer is not enough.
    expect(settledValues(once)).toEqual({});
    const twice = [
      ...once,
      presented('c', textbook),
      presented('d', none),
      preferred(['c', 'd'], 'c')
    ];
    expect(settledValues([...twice, vary('Graph.form', 'snake')])).toEqual({
      'listing.language': 'textbook',
      'Graph.form': 'snake'
    });
  });
});

describe('moot comparisons', () => {
  const answer = (settled: Record<string, string | boolean>) => ({
    eventId: 9,
    settled,
    pair: [{ 'views.Int': 'IntCell' }, { 'views.Int': 'IntTally' }] as [
      Record<string, string>,
      Record<string, string>
    ]
  });

  it('sets aside a question about what an answer settled or hid, and keeps any other', () => {
    const settled = answer({ 'Answer.shown': false, 'views.Int': 'IntTally' });
    const about = (variable: string): [Record<string, string>, Record<string, string>] => [
      { [variable]: 'a' },
      { [variable]: 'b' }
    ];
    expect(mootComparison(settled, about('views.Int'))).toBe(true);
    // The answer hid the Answer part, so how it looks is no longer open.
    expect(mootComparison(settled, about('Board.Answer.fill'))).toBe(true);
    expect(mootComparison(settled, about('Highlight.Pointed.fill'))).toBe(false);
    expect(mootComparison(answer({ 'listing.language': 'none' }), about('listing.color'))).toBe(
      true
    );
  });

  it('sets aside the pair just answered, whichever way round, though it settled nothing', () => {
    expect(
      mootComparison(answer({}), [{ 'views.Int': 'IntTally' }, { 'views.Int': 'IntCell' }])
    ).toBe(true);
    expect(
      mootComparison(answer({}), [{ 'views.Int': 'IntDots' }, { 'views.Int': 'IntCell' }])
    ).toBe(false);
  });
});
