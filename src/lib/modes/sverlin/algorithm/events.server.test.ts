import { describe, expect, it } from 'vitest';

import { maximumStepEvents, type TraceEvent } from './events.server';
import { interpretAlgorithm, interpretDomain, traceAlgorithm } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9999 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
  const Equal = binop(Int, Int, (a, b) => Flag(a === b));
  const Less = binop(Int, Int, (a, b) => Flag(a < b));
  const Up = unop(Int, (n) => Int(n + 1));
  const Append = binop(Values, Int, (c, x) => Values([...c, x]));
`);
const run = (body: string) => interpretAlgorithm(body, undefined, domain);
/** Each event as its kind and what it names, with the source it is at. */
const read = (body: string, events: TraceEvent[] = []) =>
  events.map(({ kind, at, place, name, index, held, value }) =>
    [
      kind,
      place ?? name ?? '',
      index ?? '',
      held ?? '',
      value ?? '',
      body.slice(at.start, at.end)
    ].join(' ')
  );

describe('the event log', () => {
  it('records each loop as entered, tested, iterated, and left, with continue and break', () => {
    const body = `const values = Values([1, 2, 3]);
      for (const v of values) {
        if (Equal(v, 1)) continue;
        if (Equal(v, 3)) break;
      }`;
    // Without labels, the algorithm's one step is its end, holding all of its events.
    const [step] = run(body);
    expect(read(body, step.events).filter((line) => !line.startsWith('read'))).toEqual([
      'write values    const values = Values([1, 2, 3])'.replace('const ', ''),
      'enter     for (const v of values) {\n        if (Equal(v, 1)) continue;\n        if (Equal(v, 3)) break;\n      }',
      'write v   1 const v',
      'iteration  0   for (const v of values) {\n        if (Equal(v, 1)) continue;\n        if (Equal(v, 3)) break;\n      }',
      'apply Equal   true Equal(v, 1)',
      'test   true  Equal(v, 1)',
      'continue     continue;',
      'write v   2 const v',
      'iteration  1   for (const v of values) {\n        if (Equal(v, 1)) continue;\n        if (Equal(v, 3)) break;\n      }',
      'apply Equal   false Equal(v, 1)',
      'test   false  Equal(v, 1)',
      'apply Equal   false Equal(v, 3)',
      'test   false  Equal(v, 3)',
      'write v   3 const v',
      'iteration  2   for (const v of values) {\n        if (Equal(v, 1)) continue;\n        if (Equal(v, 3)) break;\n      }',
      'apply Equal   false Equal(v, 1)',
      'test   false  Equal(v, 1)',
      'apply Equal   true Equal(v, 3)',
      'test   true  Equal(v, 3)',
      'break     break;',
      'exit     for (const v of values) {\n        if (Equal(v, 1)) continue;\n        if (Equal(v, 3)) break;\n      }'
    ]);
  });

  it('reads and writes places by the names a step records, inside calls too', () => {
    const body = `function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }
      const values = Values([5, 7]);
      swap(values, Index(0), Index(1));`;
    const [step] = run(body);
    expect(read(body, step.events)).toEqual(
      expect.arrayContaining([
        'call swap    swap(values, Index(0), Index(1))',
        'write i   0 i',
        'read values    a',
        'read values[0]   5 a[i]',
        'write t   5 t = a[i]',
        'write values[0]   7 a[i] = a[j]',
        'write values[1]   5 a[j] = t',
        'return     }'
      ])
    );
    expect(step.state.values).toEqual([7, 5]);
  });

  it('keeps each step’s latest events, counting every one', () => {
    // Stepping at each mark, the loop leads up to the first.
    const body = `@fill[let values = Values([]);
      for (let i = Int(0); Less(i, 1000); i = Up(i)) values = Append(values, i);]
      @mark[const a = Int(1);]
      @mark[const b = Int(2);]`;
    const { steps: trace } = traceAlgorithm(body, undefined, domain, 'mark');
    expect(trace).toHaveLength(2);
    expect(trace[0].events).toHaveLength(maximumStepEvents);
    expect(trace[0].events?.at(-1)?.kind).toBe('write');
    expect(trace[0].dropped).toBeGreaterThan(4000);
    // The kept events are all the loop's but the last, the step's own write.
    expect(trace[0].gap).toBe(maximumStepEvents - 1);
    expect(trace[0].counts?.events.iteration).toBe(1000);
    expect(trace[1].events?.map(({ kind }) => kind)).toEqual(['write']);
    expect(trace[1].dropped).toBeUndefined();
    expect(trace[1].counts?.events.iteration).toBe(1000);
  });

  it('counts calls by function', () => {
    const trace = run(`function f(a) { return Less(a[0], a[1]); }
      const values = Values([1, 2]);
      const x = f(values);
      const y = f(values);`);
    expect(trace.at(-1)?.counts).toMatchObject({ calls: { f: 2, Less: 2 } });
  });
});
