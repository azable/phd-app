import { describe, expect, it } from 'vitest';

import { keptKey, writtenKey } from '$lib/modes/sverlin/library/node/design-keys';
import { readDesignPatch, withoutRemoved } from '$lib/modes/sverlin/assistant/design-patch.server';

describe('design values written as one JSON string', () => {
  it('reads every key shape of a nested design as written keys, each value set', () => {
    const patch = readDesignPatch(
      JSON.stringify({
        $accent: 'teal-600',
        $cell: { radius: 4, stroke: '$line' },
        '<Value>': { padding: 0.25 },
        '{Int}': 'IntTally',
        IntCell: { '...': '$cell', fill: 'sky-100', ':target': { stroke: 'violet-500' } },
        Card: { '=true': { fill: 'amber-100' } },
        Here: { Link: { targetStrokeWidth: 2 } },
        '<Listing>': { language: 'textbook' }
      })
    );
    expect(patch).toEqual({
      set: [
        { variable: '$accent', value: 'teal-600' },
        { variable: '$cell.radius', value: 4 },
        { variable: '$cell.stroke', value: '$line' },
        { variable: '<Value>.padding', value: 0.25 },
        { variable: '{Int}', value: 'IntTally' },
        { variable: 'IntCell.inherit', value: '$cell' },
        { variable: 'IntCell.fill', value: 'sky-100' },
        { variable: 'IntCell:target.stroke', value: 'violet-500' },
        { variable: 'Card=true.fill', value: 'amber-100' },
        { variable: 'Here.Link.targetStrokeWidth', value: 2 },
        { variable: '<Listing>.language', value: 'textbook' }
      ],
      remove: []
    });
  });

  it('removes with null, and sets nothing when empty', () => {
    expect(readDesignPatch('{"Goal": {"fill": null}, "IntCell": null}')).toEqual({
      set: [],
      remove: ['Goal.fill', 'IntCell']
    });
    for (const empty of [undefined, null, '', '{}'])
      expect(readDesignPatch(empty)).toEqual({ set: [], remove: [] });
  });

  it('refuses a design written flat, inherit for "...", and an older list, naming the nested form', () => {
    expect(readDesignPatch('{"IntCell.fill": "white"}')).toEqual({
      problem: expect.stringMatching(
        /"IntCell\.fill" at the top is written flat: .* \{"IntCell": \{"fill": …\}\}/u
      )
    });
    expect(readDesignPatch('{"IntCell": {"Link.stroke": "red-500"}}')).toMatchObject({
      problem: expect.stringMatching(/"Link\.stroke" under IntCell is written flat/u)
    });
    expect(readDesignPatch('{"IntCell": {"inherit": "$cell"}}')).toMatchObject({
      problem: expect.stringMatching(/"inherit" under IntCell is written "\.\.\."/u)
    });
    expect(
      readDesignPatch('{"Bar": {"height.from": 12, ":@scan.next": {"fill": "white"}}}')
    ).toEqual({
      set: [
        { variable: 'Bar.height.from', value: 12 },
        { variable: 'Bar:@scan.next.fill', value: 'white' }
      ],
      remove: []
    });
    expect(readDesignPatch([{ variable: 'views.Int', value: 'IntTally' }])).toMatchObject({
      problem: expect.any(String)
    });
  });

  it('says why values cannot be read: not JSON, not one object, or a value of no option type', () => {
    expect(readDesignPatch('{"IntCell": {"fill": "sky-100"')).toMatchObject({
      problem: expect.stringMatching(/^The values are not valid JSON: .+ Write one JSON object/u)
    });
    expect(readDesignPatch('["IntCell"]')).toMatchObject({
      problem: expect.stringMatching(/must be one JSON object/u)
    });
    expect(readDesignPatch('{"IntCell": {"fill": [1]}}')).toEqual({
      problem: 'IntCell.fill must be a string, a number, a boolean, or null to remove it, not [1].'
    });
    expect(readDesignPatch(4)).toMatchObject({ problem: expect.stringMatching(/as a string/u) });
  });

  it('takes out of a variant what a patch removes, one value or every value under a kind', () => {
    const variant = {
      'Goal.fill': 'amber-200',
      'Goal:target.stroke': 'red-500',
      'Goal.radius': 4,
      'GoalMark.fill': 'blue-100',
      'views.Int': 'IntCell'
    };
    const without = (remove: string[]) =>
      withoutRemoved(
        variant,
        remove,
        (key) => keptKey(key),
        (key) => writtenKey(key)
      );
    expect(without(['Goal.fill'])).toEqual({
      'Goal:target.stroke': 'red-500',
      'Goal.radius': 4,
      'GoalMark.fill': 'blue-100',
      'views.Int': 'IntCell'
    });
    expect(without(['Goal', '{Int}'])).toEqual({ 'GoalMark.fill': 'blue-100' });
    expect(withoutRemoved(undefined, ['Goal'], keptKey, writtenKey)).toBeUndefined();
  });
});
