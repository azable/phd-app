import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
`);
const input = interpretInput('const values = Values([3, 8, 5, 2]); const target = Int(5);', domain);
const search = `
  @start[let checked = Int(0);]
  for (let i = Index(0); i < values.length; i++) @pass{
    @count[checked = checked + 1;]
    @check[if (values[i] === target) break;]
  }
`;
const steps = (body: string, frames?: string) => traceAlgorithm(body, input, domain, frames).steps;
const checked = (trace: ReturnType<typeof steps>) => trace.map(({ state }) => state.checked);

describe('frames', () => {
  it('offer the top level, each label with its prefix, and the labels inside one', () => {
    expect(traceAlgorithm(search, input, domain).options).toEqual([
      '*',
      'start',
      'pass',
      'pass.*',
      'pass.count',
      'pass.check'
    ]);
  });

  it('step at each run of the code a label marks, from the state before it to the state after', () => {
    const trace = steps(search, 'pass.count');
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

  it('step at each run of a label at the top, and of each label inside one', () => {
    // [3, 8, 5, 2], looking for 5: the start, three passes, and the end, out of the loop.
    expect(checked(steps(search))).toEqual([0, 1, 2, 3, 3]);
    expect(steps(search).at(-1)?.state.i).toBeUndefined();
    // Each count and each check.
    expect(checked(steps(search, 'pass.*')).slice(0, 6)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('step once at each pass of a labelled loop, its test leading up to the pass', () => {
    const loop = `
      @start[let checked = Int(0);]
      @loop[for (let i = Index(0); i < values.length; i++) {
        checked = checked + 1;
        if (values[i] === target) break;
      }]
    `;
    expect(
      steps(loop, 'loop').map(({ before, state }) => [before?.state.i, state.checked])
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      // The loop's exit, after the pass that broke out of it, is the last step, out of the loop.
      [undefined, 3]
    ]);
  });

  it('step once over statements in a row a label marks together', () => {
    const trace = steps('@both[let a = Int(1);\nlet b = Int(2);]\n@last[a = b;]', 'both');
    expect(trace[0].before?.state).not.toHaveProperty('a');
    expect(trace[0].state).toMatchObject({ a: 1, b: 2 });
  });

  it('end with a step for what runs after the last step, only where it changes the state', () => {
    // The loop's exit after the last check leaves the loop's variable behind.
    const trace = steps(search, 'pass.check');
    expect(trace).toHaveLength(4);
    expect(trace.at(-1)?.events?.map(({ kind }) => kind)).toEqual(['exit']);
    // A loop's last test changes nothing.
    const counting = '@start[let n = Int(0);]\nwhile (n < 2) @up{\n  n = n + 1;\n}';
    expect(steps(counting).map(({ state }) => state.n)).toEqual([0, 1, 2]);
  });

  it('number every step by its moment, the same whichever rule steps are by', () => {
    const byCount = steps(search, 'pass.count');
    const byCheck = steps(search, 'pass.check');
    const moments = (trace: typeof byCheck) => trace.map(({ moment }) => moment as number);
    // Each count comes before the check it leads to.
    moments(byCount)
      .slice(0, 3)
      .forEach((moment, index) => {
        expect(moment).toBeLessThan(moments(byCheck)[index]);
      });
    // Presentations stepping by different rules line up by moment, one holding its step where
    // the other has one of its own.
    const presentation = (id: string, trace: typeof byCheck) => ({
      presentationId: id,
      format: 'browser-bundle-v1' as const,
      stepSignature: 'one source',
      labels: trace.map((_, index) => `Step ${index + 1}`),
      masterSteps: moments(trace)
    });
    const frames = alignPresentationFrames([
      presentation('counts', byCount),
      presentation('checks', byCheck)
    ] as never);
    expect(frames).toHaveLength(new Set([...moments(byCount), ...moments(byCheck)]).size);
    expect(frames.some(({ held }) => held.includes('checks'))).toBe(true);
    expect(frames.some(({ held }) => held.includes('counts'))).toBe(true);
  });

  it('reject a label whose code never runs', () => {
    expect(() =>
      steps('@start[const n = Int(1);]\nif (n > 5) @never{\n  const m = Int(2);\n}', 'never')
    ).toThrow('The code labelled never never runs, so there are no steps.');
  });

  it('give a source without labels one step, its end', () => {
    const trace = steps('const n = Int(1);');
    expect(trace).toHaveLength(1);
    expect(trace[0].state.n).toBe(1);
  });
});
