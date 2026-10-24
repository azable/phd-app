import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import { interpretDomain, interpretInput, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
  const Less = binop((a: Int, b: Int) => Flag(a < b));
  const Up = unop((n: Int) => Int(n + 1));
`);
const input = interpretInput('const values = Values([3, 8, 5, 2]); const target = Int(5);', domain);
const search = `
  @start[let checked = Int(0);]
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @pass{
    @count[checked = Up(checked);]
    @check[if (Equal(values[i], target)) break;]
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

  it('offer the top level only where there are several labels at it', () => {
    // One label at the top: its own option is the top level, and the first.
    const one = traceAlgorithm(
      'for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @pass{\n  @look[const v = values[i];]\n}',
      input,
      domain
    ).options;
    expect(one).toEqual(['pass', 'pass.*', 'pass.look']);
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
    expect(first.events?.slice(first.gap).map(({ kind }) => kind)).toEqual([
      'read',
      'apply',
      'write'
    ]);
  });

  it('step at each run of a label at the top, and of each label inside one', () => {
    // [3, 8, 5, 2], looking for 5: the start and three passes; the loop's exit only drops i, so it
    // is no step, and the page rests on the pass that found 5.
    expect(checked(steps(search))).toEqual([0, 1, 2, 3]);
    expect(steps(search).at(-1)?.state.i).toBe(2);
    // Each count and each check.
    expect(checked(steps(search, 'pass.*')).slice(0, 6)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('step once at each pass of a labelled loop, its test leading up to the pass', () => {
    const loop = `
      @start[let checked = Int(0);]
      @loop[for (let i = Index(0); Before(i, Length(values)); i = Next(i)) {
        checked = Up(checked);
        if (Equal(values[i], target)) break;
      }]
    `;
    expect(
      steps(loop, 'loop').map(({ before, state }) => [before?.state.i, state.checked])
    ).toEqual([
      [0, 1],
      [1, 2],
      // The pass that breaks out; the loop's exit after it only drops i, so it is no step.
      [2, 3]
    ]);
  });

  it('step once over statements in a row a label marks together', () => {
    const trace = steps('@both[let a = Int(1);\nlet b = Int(2);]\n@last[a = b;]', 'both');
    expect(trace[0].before?.state).not.toHaveProperty('a');
    expect(trace[0].state).toMatchObject({ a: 1, b: 2 });
  });

  it('end with a step for what runs after the last step, only where it changes a value in scope', () => {
    // The loop's exit after the last check only drops the loop's variable: no step.
    const trace = steps(search, 'pass.check');
    expect(trace).toHaveLength(3);
    expect(trace.at(-1)?.state.i).toBe(2);
    // A write after the loop, labelled but not stepped at, makes the end a step, the exit in it.
    const after = steps(`${search}\n@more[checked = Up(checked);]`, 'pass.check');
    expect(after).toHaveLength(4);
    expect(after.at(-1)?.state).not.toHaveProperty('i');
    expect(after.at(-1)?.state.checked).toBe(4);
    expect(after.at(-1)?.events?.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['exit', 'apply', 'write'])
    );
    // A loop's last test changes nothing.
    const counting = '@start[let n = Int(0);]\nwhile (Less(n, 2)) @up{\n  n = Up(n);\n}';
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

  it('open on the input as given, whether the first step declares or changes', () => {
    // Step 0 holds only the input's variables, before any of the algorithm runs.
    for (const body of [search, '@bump[values[0] = target;]']) {
      const { opening, steps: run } = traceAlgorithm(body, input, domain);
      expect(Object.keys(opening.state)).toEqual(['values', 'target']);
      expect(opening.state.values).toEqual([3, 8, 5, 2]);
      expect(opening.events).toEqual([]);
      expect(opening.moment).toBe(0);
      expect(run[0].moment).toBeGreaterThan(0);
    }
    // Without an input block, step 0 is empty.
    expect(traceAlgorithm('@a[const n = Int(1);]', undefined, domain).opening.state).toEqual({});
  });

  it('reject a label whose code never runs', () => {
    expect(() =>
      steps('@start[const n = Int(1);]\nif (Less(5, n)) @never{\n  const m = Int(2);\n}', 'never')
    ).toThrow('The code labelled never never runs, so there are no steps.');
  });

  it('give a source without labels one step, its end', () => {
    const trace = steps('const n = Int(1);');
    expect(trace).toHaveLength(1);
    expect(trace[0].state.n).toBe(1);
  });
});
