import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import { interpretDomain, interpretInput, traceAlgorithm, type Pacing } from './interpret.server';

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
const steps = (body: string, pacing?: Pacing) => traceAlgorithm(body, input, domain, pacing).steps;
// Pausing at each label given, accumulating.
const pausedAt = (...labels: string[]) =>
  new Map(labels.map((label) => [label, 'accumulate' as const]));
const checked = (trace: ReturnType<typeof steps>) => trace.map(({ state }) => state.checked);
// A view showing each comparison, rendered at a label around the whole algorithm.
const shown: Pacing['shown'] = new Map([['Equal', [{ start: 0, end: Infinity }]]]);

describe('pauses at labels', () => {
  it('step at the end of each run of a label paused at, from the state before it to the state after', () => {
    // [3, 8, 5, 2], looking for 5: the start and three counts; the loop's exit only drops i, so it
    // is no step.
    const trace = steps(search, { pauses: pausedAt('start', 'pass.count') });
    expect(checked(trace)).toEqual([0, 1, 2, 3]);
    expect(trace.at(-1)?.state.i).toBe(2);
    expect(
      trace.slice(1, 4).map(({ before, state }) => [before?.state.checked, state.checked])
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3]
    ]);
    // The events leading up to the code, then its own.
    expect(trace[1].events?.slice(trace[1].gap).map(({ kind }) => kind)).toEqual([
      'read',
      'apply',
      'write'
    ]);
  });

  it('pause at every label, on, where no pauses are given, whatever the view shows', () => {
    const every = new Map(
      ['start', 'pass', 'pass.count', 'pass.check'].map((label) => [label, 'on' as const])
    );
    const trace = steps(search);
    expect(trace.map(({ state, unit }) => [state.checked, unit !== undefined])).toEqual(
      steps(search, { pauses: every }).map(({ state, unit }) => [state.checked, unit !== undefined])
    );
    expect(steps(search, { shown })).toHaveLength(trace.length);
  });

  it('keep the applications of an operator the view shows at the step that makes them', () => {
    const trace = steps(search, { shown, pauses: pausedAt('start', 'pass.count', 'pass.check') });
    // The start, then each count and each check; the check finding 5 ends the search.
    expect(
      trace.map(({ state, applied }) => [
        state.checked,
        applied?.Equal?.map(({ state }) => `${state.a} = ${state.b}`) ?? []
      ])
    ).toEqual([
      [0, []],
      [1, []],
      [1, ['3 = 5']],
      [2, []],
      [2, ['8 = 5']],
      [3, []],
      [3, ['5 = 5']]
    ]);
    const [, , check] = trace;
    expect(check.events?.slice(check.gap).map(({ kind }) => kind)).toContain('apply');
    expect(check.unit).toBeDefined();
  });

  it('pause only at the labels given, the code of those not given joining the next step', () => {
    // Pausing at the checks alone: each count leads up to its check.
    const checks = steps(search, { shown, pauses: pausedAt('pass.check') });
    expect(checks.map(({ before, state }) => [before?.state.checked, state.checked])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ]);
    expect(checks.every(({ applied }) => applied?.Equal?.length === 1)).toBe(true);
    // Pausing at the pass as well, which ends after each check, adds a step that changes nothing.
    expect(steps(search, { shown, pauses: pausedAt('pass', 'pass.check') })).toHaveLength(6);
    // Pausing nowhere leaves the end alone.
    expect(steps(search, { shown, pauses: pausedAt() })).toHaveLength(1);
  });

  it('keep an operator’s applications only inside the label a view is narrowed to', () => {
    const body = search.replace(
      '@count[checked = Up(checked);]',
      '@count[checked = Up(checked);]\n    @keep[const same = @same[Equal(target, target)];]'
    );
    const start = body.indexOf('@check[');
    const narrowed = new Map([['Equal', [{ start, end: body.indexOf('break;]', start) + 7 }]]]);
    const pauses = pausedAt('pass.keep', 'pass.check');
    const equals = (shown: Pacing['shown']) =>
      steps(body, { shown, pauses }).map(({ applied }) => applied?.Equal?.length ?? 0);
    expect(equals(shown).slice(0, 2)).toEqual([1, 1]);
    expect(equals(narrowed).slice(0, 2)).toEqual([0, 1]);
  });

  it('step at each run of a label whose value the view draws, though it changes nothing', () => {
    const body =
      'for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @pass{\n  const v = @look[values[i]];\n}';
    const trace = traceAlgorithm(
      body,
      input,
      domain,
      { pauses: new Map([['pass.look', 'on']]) },
      { labels: new Set(['pass.look']) }
    ).steps;
    expect(trace.map(({ labelled }) => labelled?.['pass.look']?.[0].state.value)).toEqual([
      3, 8, 5, 2
    ]);
  });

  it('join code outside every label to the next step, leading up to it', () => {
    const [step] = steps('let n = Up(Int(0));\n@a[n = Up(n);]');
    expect(step.before?.state.n).toBe(1);
    expect(step.state.n).toBe(2);
    expect(step.events?.slice(0, step.gap).map(({ kind }) => kind)).toContain('write');
  });

  it('step once at each pass of a labelled loop', () => {
    const loop = `
      @start[let checked = Int(0);]
      @loop[for (let i = Index(0); Before(i, Length(values)); i = Next(i)) {
        checked = Up(checked);
        if (Equal(values[i], target)) break;
      }]
    `;
    expect(steps(loop).map(({ before, state }) => [before?.state.i, state.checked])).toEqual([
      [undefined, 0],
      [0, 1],
      [1, 2],
      // The pass that breaks out; the loop's exit after it only drops i, so it is no step.
      [2, 3]
    ]);
  });

  it('step once over statements in a row a label marks together', () => {
    const trace = steps('@both[let a = Int(1);\nlet b = Int(2);]\n@last[a = b;]');
    expect(trace[0].before?.state).not.toHaveProperty('a');
    expect(trace[0].state).toMatchObject({ a: 1, b: 2 });
    expect(trace[1].state).toMatchObject({ a: 2, b: 2 });
  });

  it('end with a step for what runs after the last step, only where it changes a value in scope', () => {
    // A write after the loop to what the view does not draw is no step of its own, but makes the
    // end one, the loop's exit in it.
    const after = steps(`${search}\n@more[checked = Up(checked);]`, {
      shown,
      pauses: pausedAt('pass.check')
    });
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

  it('number every step by its moment, the same however steps are paced', () => {
    const byCount = steps(search, { pauses: pausedAt('start', 'pass.count') });
    const byCheck = steps(search, { shown, pauses: pausedAt('pass.check') });
    const moments = (trace: typeof byCheck) => trace.map(({ moment }) => moment as number);
    // Each count comes before the comparison it leads to.
    moments(byCount)
      .slice(1, 4)
      .forEach((moment, index) => {
        expect(moment).toBeLessThan(moments(byCheck)[index]);
      });
    // Presentations paced differently line up by moment, one holding its step where the other has
    // one of its own.
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

  it('give a source without labels one step, its end', () => {
    const trace = steps('const n = Int(1);');
    expect(trace).toHaveLength(1);
    expect(trace[0].state.n).toBe(1);
  });
});
