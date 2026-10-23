import { describe, expect, it } from 'vitest';

import { alignPresentationFrames } from '$lib/shared/presentations';

import {
  interpretDomain,
  interpretInput,
  traceAlgorithm,
  type FrameRule
} from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
`);
const input = interpretInput('const values = Values([3, 8, 5, 2]); const target = Int(5);', domain);
const search = `
  for (let i = Index(0); i < values.length; i++) {
    if (Matches({ at: i, target })) break;
  }
`;
const steps = (body: string, frames: FrameRule) =>
  traceAlgorithm(body, input, domain, frames).steps;

describe('frames', () => {
  it('step by each call of an operation, then once more at the end, with no yield', () => {
    const trace = steps(search, { operation: 'Matches' });
    expect(trace.map(({ state }) => state.i)).toEqual([0, 1, 2, undefined]);
    expect(trace.map(({ state }) => (state.event as { Matches: unknown[] }).Matches)).toEqual([
      [{ at: 0, target: 5 }],
      [{ at: 1, target: 5 }],
      [{ at: 2, target: 5 }],
      []
    ]);
    // The last step holds what came after the last call: the test that held, the break, the exit.
    expect(trace.at(-1)?.events?.map(({ kind }) => kind)).toEqual(['test', 'break', 'exit']);
  });

  it('step by each iteration of a loop', () => {
    const trace = steps(search, 'iteration');
    expect(trace.map(({ state }) => state.i)).toEqual([0, 1, 2, undefined]);
    expect(trace[0].events?.at(-1)?.kind).toBe('iteration');
  });

  it('number every step by its moment, the same whichever events are steps', () => {
    const body = `${search} yield;`;
    const byCall = steps(body, { operation: 'Matches' });
    const byIteration = steps(body, 'iteration');
    const byYield = steps(body, 'yield');
    const moments = (trace: typeof byCall) => trace.map(({ moment }) => moment as number);
    // An iteration comes before the call it makes; the yield comes last of all.
    moments(byIteration)
      .slice(0, 3)
      .forEach((moment, index) => {
        expect(moment).toBeLessThan(moments(byCall)[index]);
      });
    expect(moments(byYield)).toEqual([moments(byCall).at(-1)]);
    // Presentations stepping by different events line up by moment, one holding its step where
    // the other has one of its own.
    const presentation = (id: string, trace: typeof byCall) => ({
      presentationId: id,
      format: 'browser-bundle-v1' as const,
      stepSignature: 'one source',
      labels: trace.map((_, index) => `Step ${index + 1}`),
      masterSteps: moments(trace)
    });
    const frames = alignPresentationFrames([
      presentation('calls', byCall),
      presentation('yield', byYield)
    ] as never);
    expect(frames).toHaveLength(byCall.length);
    expect(frames.map(({ localSteps }) => localSteps.yield)).toEqual(byCall.map(() => 0));
    expect(frames.slice(0, -1).every(({ held }) => held.includes('yield'))).toBe(true);
  });

  it('reject a rule the algorithm takes no steps by', () => {
    expect(() => steps('const n = Int(1);', 'iteration')).toThrow(
      'never makes the calls or iterations its steps are'
    );
  });
});
