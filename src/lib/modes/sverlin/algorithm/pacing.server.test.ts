import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import { interpretDomain, interpretInput, traceAlgorithm, type Pacing } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
  const Flag = type('boolean');
`);
const input = interpretInput('const values = Values([3, 8, 5, 2]); const target = Int(5);', domain);
const search = `
  @start[let checked = Int(0);]
  for (let i = Index(0); (i < values.length); i++) @pass{
    @count[checked++;]
    @check[if (@equal[values[i] === target]) break;]
  }
`;
const steps = (body: string, pacing?: Pacing, applications?: ReadonlySet<string>) =>
  traceAlgorithm(body, input, domain, pacing, applications ? { applications } : {}).steps;
// Pausing at each label given, accumulating.
const pausedAt = (...labels: string[]) =>
  new Map(labels.map((label) => [label, 'accumulate' as const]));
const checked = (trace: ReturnType<typeof steps>) => trace.map(({ state }) => state.checked);
// A view typed by the comparison's label, which keeps its operands and result at each step.
const shown = new Set(['pass.check.equal']);
const equal = 'ℓpassˑcheckˑequal';

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
    expect(trace[1].events?.slice(trace[1].gap).map(({ kind }) => kind)).toEqual(['read', 'write']);
  });

  it('pause at every label, on, where no pauses are given, whatever the view shows', () => {
    const every = new Map(
      ['start', 'pass', 'pass.count', 'pass.check', 'pass.check.equal'].map((label) => [
        label,
        'on' as const
      ])
    );
    const trace = steps(search);
    expect(trace.map(({ state, unit }) => [state.checked, unit !== undefined])).toEqual(
      steps(search, { pauses: every }).map(({ state, unit }) => [state.checked, unit !== undefined])
    );
    expect(steps(search, {}, shown)).toHaveLength(trace.length);
  });

  it('keep what a labelled expression a view is typed by computed, at the step that computes it', () => {
    const trace = steps(search, { pauses: pausedAt('start', 'pass.count', 'pass.check') }, shown);
    // The start, then each count and each check; the check finding 5 ends the search.
    expect(
      trace.map(({ state, applied }) => [
        state.checked,
        applied?.[equal]?.map(({ state }) => `${state.left} = ${state.right}`) ?? []
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
    expect(check.unit).toBeDefined();
  });

  it('pause only at the labels given, the code of those not given joining the next step', () => {
    // Pausing at the checks alone: each count leads up to its check.
    const checks = steps(search, { pauses: pausedAt('pass.check') }, shown);
    expect(checks.map(({ before, state }) => [before?.state.checked, state.checked])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ]);
    expect(checks.every(({ applied }) => applied?.[equal]?.length === 1)).toBe(true);
    // Pausing at the pass as well, which ends after each check, adds a step that changes nothing.
    expect(steps(search, { pauses: pausedAt('pass', 'pass.check') }, shown)).toHaveLength(6);
    // Pausing nowhere leaves the end alone.
    expect(steps(search, { pauses: pausedAt() }, shown)).toHaveLength(1);
  });

  it('keep only the labelled expressions a view is typed by', () => {
    const pauses = pausedAt('pass.check');
    const kept = (applications: ReadonlySet<string>) =>
      steps(search, { pauses }, applications).map(({ applied }) => applied?.[equal]?.length ?? 0);
    expect(kept(shown).slice(0, 2)).toEqual([1, 1]);
    expect(kept(new Set()).slice(0, 2)).toEqual([0, 0]);
  });

  it('step at each run of a label whose value the view draws, though it changes nothing', () => {
    const body =
      'for (let i = Index(0); (i < values.length); i++) @pass{\n  const v = @look[values[i]];\n}';
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
    const [step] = steps('let n = Int(0) + 1;\n@a[n++;]');
    expect(step.before?.state.n).toBe(1);
    expect(step.state.n).toBe(2);
    expect(step.events?.slice(0, step.gap).map(({ kind }) => kind)).toContain('write');
  });

  it('step once at each pass of a labelled loop', () => {
    const loop = `
      @start[let checked = Int(0);]
      @loop[for (let i = Index(0); (i < values.length); i++) {
        checked++;
        if ((values[i] === target)) break;
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
    const after = steps(`${search}\n@more[checked++;]`, { pauses: pausedAt('pass.check') }, shown);
    expect(after).toHaveLength(4);
    expect(after.at(-1)?.state).not.toHaveProperty('i');
    expect(after.at(-1)?.state.checked).toBe(4);
    expect(after.at(-1)?.events?.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['exit', 'write'])
    );
    // A loop's last test changes nothing.
    const counting = '@start[let n = Int(0);]\nwhile ((n < 2)) @up{\n  n++;\n}';
    expect(steps(counting).map(({ state }) => state.n)).toEqual([0, 1, 2]);
  });

  it('refuse two labels on the same code, which could never pause or draw apart', () => {
    const same = `
  let n = Int(0);
  while ((n < 2)) @up{
    @add[@one[n++;]]
  }
`;
    expect(() => steps(same)).toThrow(
      '@up.add.one marks the same code as @up.add, so the two can never pause or draw apart: keep one name.'
    );
  });

  it('run a label around statements in a row to its last, the labels inside it included', () => {
    const merged = `
  let n = Int(0);
  @outer[
    @first[n++; n++;]
    while ((n < 4)) @take{
      n++;
    }
  ]
`;
    const all = steps(merged);
    expect(all.map(({ name, state }) => [name, state.n])).toEqual([
      ['@outer.first#1', 2],
      ['@outer.take#1', 3],
      ['@outer.take#2', 4],
      ['@outer#1', 4]
    ]);
    // Every take is inside the outer label's run.
    expect(all.slice(1, 3).every(({ inside }) => inside?.includes('outer'))).toBe(true);
    // Paused at the outer label alone, its one step comes after the loop.
    expect(
      steps(merged, { pauses: new Map([['outer', 'on']]) }).map(({ name, state }) => [
        name,
        state.n
      ])
    ).toEqual([['@outer#1', 4]]);
    // Labelled statements in a row each count once, the outer label's end named after it.
    const rows = `
  let n = Int(0);
  @outer[@first[n++;] @second[n++;]]
`;
    expect(steps(rows).map(({ name, state }) => [name, state.n])).toEqual([
      ['@outer.first#1', 1],
      ['@outer.second#1', 2],
      ['@outer#1', 2]
    ]);
  });

  it('number a label’s runs in the order they begin, each step named where its run ends', () => {
    const recursive = `
  function count(n) @call{
    if ((n < 2)) @deeper[count((n + 1));]
  }
  @go[count(Int(0));]
`;
    // The first call made is @call#1, though it ends last, after the calls inside it.
    expect(steps(recursive).map(({ name, state }) => [name, state.n])).toEqual([
      ['@call#3', 2],
      ['@call.deeper#2', 1],
      ['@call#2', 1],
      ['@call.deeper#1', 0],
      ['@call#1', 0],
      ['@go#1', undefined]
    ]);
  });

  it('keep the code an accumulating row has run lit at the steps inside it', () => {
    const merged = `
  let n = Int(0);
  @outer[
    @first[n++;]
    while ((n < 3)) @take{
      n++;
    }
  ]
`;
    const run = steps(merged, {
      pauses: new Map([
        ['outer', 'accumulate'],
        ['outer.take', 'on']
      ])
    });
    expect(run.map(({ name }) => name)).toEqual(['@outer.take#1', '@outer.take#2', '@outer#1']);
    // Each take keeps lit what the outer run did before it, from the first label's code on.
    for (const step of run.slice(0, 2))
      expect(step.trail?.some(([, , labels]) => labels.includes('outer'))).toBe(true);
  });

  it('number every step by its moment, the same however steps are paced', () => {
    const byCount = steps(search, { pauses: pausedAt('start', 'pass.count') });
    const byCheck = steps(search, { pauses: pausedAt('pass.check') }, shown);
    const moments = (trace: typeof byCheck) => trace.map(({ moment }) => moment as number);
    // Each count comes before the comparison it leads to.
    moments(byCount)
      .slice(1, 4)
      .forEach((moment, index) => {
        expect(moment).toBeLessThan(moments(byCheck)[index]);
      });
    // Presentations paced differently line up by their steps' names among those of every label
    // paused, one holding its step where the other has one of its own.
    const every = steps(search, {}, shown).map(({ name }) => name as string);
    const presentation = (id: string, trace: typeof byCheck) => ({
      presentationId: id,
      format: 'browser-bundle-v1' as const,
      stepSignature: 'one source',
      labels: trace.map(({ name }) => name as string),
      steps: every
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

  it('give a fragment without labels one step, its end', () => {
    const trace = steps('const n = Int(1);');
    expect(trace).toHaveLength(1);
    expect(trace[0].state.n).toBe(1);
  });
});

describe('no code outside a label, in an authored source', () => {
  const authored = (body: string) => traceAlgorithm(body, input, domain, {}, {}, true).steps;
  const names = (body: string) => authored(body).map(({ name }) => name);
  const labelled = `
  @start[let checked = Int(0);]
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) @pass{
    @count[checked++;]
    @check[if (@found[values[i] === target]) break;]
  }
`;

  it('runs a for header’s parts in order: the start, the test before each pass, the move after it', () => {
    // [3, 8, 5, 2], looking for 5: the third pass breaks, so no move or test follows it.
    expect(names(labelled)).toEqual([
      '@start#1',
      '@first#1',
      '@more#1',
      '@pass.count#1',
      '@pass.check.found#1',
      '@pass.check#1',
      '@pass#1',
      '@next#1',
      '@more#2',
      '@pass.count#2',
      '@pass.check.found#2',
      '@pass.check#2',
      '@pass#2',
      '@next#2',
      '@more#3',
      '@pass.count#3',
      '@pass.check.found#3',
      '@pass.check#3',
      '@pass#3'
    ]);
  });

  it('ends a loop that runs out with its test, its last value false', () => {
    const counting = `
  @start[let n = Int(0);]
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) @pass{
    n++;
  }
`;
    const trace = traceAlgorithm(counting, input, domain, {}, { labels: new Set(['more']) }, true);
    const tests = trace.steps.filter(({ name }) => name?.startsWith('@more'));
    expect(tests.map(({ labelled }) => labelled?.more?.[0].state.value)).toEqual([
      true,
      true,
      true,
      true,
      false
    ]);
    expect(trace.steps.at(-1)?.name).toBe('@more#5');
  });

  it('refuses a statement outside every label, at the top level and in a function', () => {
    expect(() => authored('let n = Int(0);')).toThrow(
      'let n = Int(0); runs outside every label, and no code may: wrap it, as @name[let n = Int(0);].'
    );
    expect(() => authored('function f(x) { return x; }\n@run[const y = f(Int(1));]')).toThrow(
      "return x; runs outside every label, and no code may: wrap it, as @name[return x;], or label the function's body, as function f(…) @f{."
    );
    // Declarations leading a labelled block need no label of their own.
    expect(() =>
      authored('function f(x) @f{ const y = x; @give[return y;] }\n@run[const z = f(Int(1));]')
    ).not.toThrow();
  });

  it('refuses a test or a part of a for header without a label of its own', () => {
    expect(() =>
      authored(labelled.replace('@found[values[i] === target]', '(values[i] === target)'))
    ).toThrow(
      // Inside @check, around the if, the test is still not a label's own code.
      'The test of if (…), values[i] === target, is in no label of its own, so the decision it makes would not show: label it, as @name[values[i] === target].'
    );
    expect(() => authored(labelled.replace('@next[i++]', 'i++'))).toThrow(
      'The update of for (…), i++, is in no label of its own'
    );
    // Conditions joined by && and ||, each a label's own, are enough.
    expect(() =>
      authored(
        labelled.replace(
          '@found[values[i] === target]',
          '@found[values[i] === target] || @low[values[i] < Int(0)]'
        )
      )
    ).not.toThrow();
  });

  it('refuses a for … of loop, advising an index loop with its parts labelled', () => {
    expect(() =>
      authored('@start[let n = Int(0);]\nfor (const v of values) @each{ n++; }')
    ).toThrow('for (… of values) walks values in a header no label can split; write an index loop');
  });
});
