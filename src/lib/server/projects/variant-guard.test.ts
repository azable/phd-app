import { describe, expect, it } from 'vitest';

import { resampledVariants } from '$lib/modes/sverlin/chooser-decisions.server';
import type { ProjectEvent } from '$lib/shared/projects/events';

// A resample of a linear search the Decisions API answered wanting to hide most of the picture:
// Board (all of it) 0.67, Answer 0.70, EqualityQuestion 0.68, the listing 0.93.
import recorded from './fixtures/decisions-hides-most.json';
import {
  allowedChange,
  guardedChoice,
  hiddenShare,
  hides,
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
  it('reads what the root renders and what each snippet renders', () => {
    // Board, and the position type the view marks as a pointer.
    expect(tree.root).toEqual(['Board', 'Index']);
    expect(tree.snippets.get('Board')).toEqual(['<Listing>', 'SearchView']);
    expect(tree.snippets.get('SearchView')).toContain('Answer');
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
    expect(hiddenShare(tree, recorded.variant, [['FoundCaption.shown', false]])).toBeLessThan(0.1);
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
  const presented = (presentationId: string, variant: Record<string, string>) =>
    ({
      type: 'visualization.presented',
      payload: { presentation: { format: 'browser-bundle-v1', presentationId, variant } }
    }) as unknown as ProjectEvent;

  it('settles where a preferred presentation differed, and what a vary decision set', () => {
    const events = [
      presented('a', { 'listing.language': 'textbook', 'Cell.fill': 'white' }),
      presented('b', { 'listing.language': 'none', 'Cell.fill': 'white' }),
      {
        type: 'visualization.preference-recorded',
        payload: { presentations: ['a', 'b'], preferred: 'a' }
      } as unknown as ProjectEvent,
      {
        type: 'ai.generation-succeeded',
        payload: {
          response: {
            text: JSON.stringify({
              output_text: JSON.stringify({
                decision: {
                  action: 'vary',
                  values: [{ variable: 'Graph.form', value: 'snake' }],
                  randomise: []
                }
              })
            })
          }
        }
      } as unknown as ProjectEvent
    ];
    expect(settledValues(events)).toEqual({
      'listing.language': 'textbook',
      'Graph.form': 'snake'
    });
  });
});
