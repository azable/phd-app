import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
`);
const input = interpretInput('const values = Values([3, 8, 5, 2]); const target = Int(5);', domain);
const search = `
  let checked = Int(0);
  for (let i = Index(0); i < values.length; i++) { // @pass
    checked = checked + 1; // @count
    if (Matches({ at: i, target })) break;
  }
`;
const steps = (body: string, label?: string) => traceAlgorithm(body, input, domain, label).steps;

describe('frames', () => {
  it('step at each run of the code a label marks, from the state before it to the state after', () => {
    const trace = steps(search, 'count');
    expect(
      trace.slice(0, 3).map(({ before, state }) => [before?.state.checked, state.checked])
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3]
    ]);
    // The events leading up to the code, then its own.
    const [first] = trace;
    expect(first.events?.slice(first.gap).map(({ kind }) => kind)).toEqual(['read', 'write']);
  });

  it('step at every label of a group, a dotted label’s prefix, which the labels offer too', () => {
    const sort = `
      for (let i = Index(0); i < values.length - 1; i++) {
        if (values[i + 1] < values[i]) { // @move.compare: values[i + 1] < values[i]
          const moved = values[i];
          values[i] = values[i + 1];
          values[i + 1] = moved; // @move.swap
        }
      }
    `;
    const traced = traceAlgorithm(sort, input, domain, 'move');
    expect(traced.labels).toEqual(['move.compare', 'move.swap', 'move']);
    // [3, 8, 5, 2]: compare 0 and 1; compare 1 and 2, swap; compare 2 and 3, swap; the end.
    expect(traced.steps.map(({ state }) => (state.values as number[]).join(''))).toEqual([
      '3852',
      '3852',
      '3582',
      '3582',
      '3528',
      '3528'
    ]);
    expect(steps(sort, 'move.swap')).toHaveLength(3);
  });

  it('step at each call of an operation, its name a label of its calls', () => {
    const trace = steps(search, 'Matches');
    expect(trace.slice(0, 3).map(({ state }) => state.i)).toEqual([0, 1, 2]);
    // Its operands are read leading up to it; the step's own code starts as the call opens, the
    // call already recorded in its before.
    expect(trace[0].events?.slice(trace[0].gap)[0]?.kind).toBe('open');
    expect((trace[0].before?.state.event as { Matches: unknown[] }).Matches).toEqual([
      { at: 0, target: 5 }
    ]);
  });

  it('step once at each pass of a labelled loop', () => {
    const trace = steps(search, 'pass');
    expect(trace.map(({ before, state }) => [before?.state.i, state.checked])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      // The loop's exit, after the pass that broke out of it, is the last step, out of the loop.
      [undefined, 3]
    ]);
  });

  it('end with a step for what runs after the last labelled code', () => {
    const trace = steps(search, 'Matches');
    // The break after the last call, and the loop's exit, are a step of their own.
    expect(trace).toHaveLength(4);
    expect(trace.at(-1)?.events?.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['test', 'break', 'exit'])
    );
  });

  it('step by the first label written where none is chosen', () => {
    expect(steps(search).map(({ state }) => state.checked)).toEqual(
      steps(search, 'pass').map(({ state }) => state.checked)
    );
  });

  it('number every step by its moment, the same whichever label steps are by', () => {
    const byCount = steps(search, 'count');
    const byCall = steps(search, 'Matches');
    const moments = (trace: typeof byCall) => trace.map(({ moment }) => moment as number);
    // Each count comes before the call it leads to.
    moments(byCount)
      .slice(0, 3)
      .forEach((moment, index) => {
        expect(moment).toBeLessThan(moments(byCall)[index]);
      });
    // Presentations stepping by different labels line up by moment, one holding its step where
    // the other has one of its own.
    const presentation = (id: string, trace: typeof byCall) => ({
      presentationId: id,
      format: 'browser-bundle-v1' as const,
      stepSignature: 'one source',
      labels: trace.map((_, index) => `Step ${index + 1}`),
      masterSteps: moments(trace)
    });
    const frames = alignPresentationFrames([
      presentation('counts', byCount),
      presentation('calls', byCall)
    ] as never);
    expect(frames).toHaveLength(new Set([...moments(byCount), ...moments(byCall)]).size);
    expect(frames.some(({ held }) => held.includes('calls'))).toBe(true);
    expect(frames.some(({ held }) => held.includes('counts'))).toBe(true);
  });

  it('reject a label whose code never runs', () => {
    expect(() =>
      steps('const n = Int(1);\nif (n > 5) {\n  const m = Int(2); // @never\n}', 'never')
    ).toThrow('The code labelled never never runs, so there are no steps.');
  });

  it('give a source without labels one step, its end', () => {
    const trace = steps('const n = Int(1);');
    expect(trace).toHaveLength(1);
    expect(trace[0].state.n).toBe(1);
  });
});
