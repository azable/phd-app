import { describe, expect, it } from 'vitest';

import { callTypes } from './calls.server';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import framesFixture from './fixtures/call-frames.sverlin?raw';
import fibFixture from './fixtures/fib-calls.sverlin?raw';
import { designOnlyWarning } from './padding-warnings.server';

const problemOf = (source: string) => {
  try {
    prepareSvelteComponent(source);
  } catch (cause) {
    return (cause as Error).message;
  }
  return '';
};

describe('call types', () => {
  it("rewrites a view and a query of a call to its function's label, taking the call's max", () => {
    const { source, calls, problems } = callTypes(framesFixture);
    expect(problems).toEqual([]);
    expect(calls).toEqual([
      {
        name: 'SortCall',
        function: 'sort',
        label: 'sort',
        parameters: ['a', 'b', 'lo', 'hi'],
        fields: [],
        max: 4
      }
    ]);
    expect(source).toContain('<View of="@sort"');
    expect(source).toMatch(/<Select name="stack" from="@sort"[^>]*max="4"/u);
    expect(source).not.toContain("call('sort'");
  });

  it('draws the call stack of merge sort from a call type', async () => {
    const { labels, warnings } = await bundlePresentation(prepareSvelteComponent(framesFixture), 1);
    expect(labels[0]).toBe(':before');
    expect(labels).toContain('@sort.merge#7');
    // Its look's padding nobody sees aside, which the build tells too.
    expect((warnings ?? []).filter((warning) => !warning.endsWith(designOnlyWarning))).toEqual([]);
  });

  it("gives a call's result once it has returned", async () => {
    const { labels } = await bundlePresentation(prepareSvelteComponent(fibFixture), 1);
    expect(labels).toContain('@fib#5');
  });

  it('refuses a call of no function, of an unlabelled body, with an unknown option, or reading an undeclared local', () => {
    const swap = (from: string, to: string) => framesFixture.replace(from, to);
    expect(problemOf(swap("call('sort'", "call('sorted'"))).toContain(
      'SortCall is a call of sorted, which is no function of the algorithm'
    );
    expect(
      problemOf(swap('function sort(a, b, lo, hi) @sort{', 'function sort(a, b, lo, hi) {'))
    ).toContain('whose body has no label of its own');
    expect(problemOf(swap('{ max: 4 }', '{ max: 4, depth: 2 }'))).toContain(
      'takes max, the most calls open at once, and fields'
    );
    expect(problemOf(swap('sort({this.lo}, {this.hi})', 'sort({this.lo}, {this.mid})'))).toContain(
      "mid is none of them: name it, as call('sort', { fields: ['mid'] })"
    );
  });
});
