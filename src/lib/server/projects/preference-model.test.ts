import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import {
  choiceBeliefs,
  choiceStates,
  fitPreferences,
  preferenceEvidence,
  type Duel
} from './preference-model';
import { answersAfter } from './variant-guard';

const duel = (
  first: string,
  second: string,
  outcome: Duel['outcome'] = 'win',
  weight = 1
): Duel => ({
  first: { x: first },
  second: { x: second },
  outcome,
  weight,
  eventId: 1
});
const best = (duels: Duel[]) => choiceBeliefs(fitPreferences(duels)).get('x')!;

/** Events of a project: presented variants, answers, and vary decisions, numbered in order. */
function project() {
  const events: ProjectEvent[] = [];
  const push = (event: object) =>
    events.push({ id: events.length + 1, ...event } as unknown as ProjectEvent);
  let presentation = 0;
  const show = (variant: Record<string, string>) => {
    const presentationId = `p${++presentation}`;
    push({
      type: 'visualization.presented',
      payload: { presentation: { format: 'browser-bundle-v1', presentationId, variant } }
    });
    return presentationId;
  };
  return {
    events,
    /** A pair differing in views.Int, answered with the winner, a tie or a skip. */
    answer(left: string, right: string, answer: 'left' | 'right' | 'tie' | 'skip') {
      const ids: [string, string] = [show({ 'views.Int': left }), show({ 'views.Int': right })];
      push({
        type: 'visualization.preference-recorded',
        payload:
          answer === 'tie' || answer === 'skip'
            ? { presentations: ids, outcome: answer }
            : { presentations: ids, preferred: ids[answer === 'left' ? 0 : 1] }
      });
    },
    vary(variable: string, value: string) {
      push({
        type: 'ai.generation-succeeded',
        payload: {
          response: {
            text: JSON.stringify({ decision: { action: 'vary', values: [{ variable, value }] } })
          }
        }
      });
    }
  };
}
const stateOf = (events: readonly ProjectEvent[]) =>
  choiceStates(preferenceEvidence(events)).get('views.Int');

describe('the preference model', () => {
  it('grows surer of an option with each agreeing answer, and splits on disagreeing ones', () => {
    const one = best([duel('a', 'b')]);
    const two = best([duel('a', 'b'), duel('a', 'b')]);
    expect(one.likeliest).toBe('a');
    expect(one.probability).toBeGreaterThan(0.7);
    expect(one.probability).toBeLessThan(0.9);
    expect(two.probability).toBeGreaterThan(0.9);
    expect(best([duel('a', 'b'), duel('b', 'a')]).probability).toBeCloseTo(0.5, 1);
  });

  it('reads a tie as the two being close, pulling a lead back', () => {
    const lead = best([duel('a', 'b'), duel('a', 'b')]).probability;
    const tied = best([
      duel('a', 'b'),
      duel('a', 'b'),
      duel('a', 'b', 'tie'),
      duel('a', 'b', 'tie')
    ]);
    expect(tied.probability).toBeLessThan(lead);
    expect(best([duel('a', 'b', 'tie')]).probability).toBeCloseTo(0.5, 1);
  });

  it('shares credit across the options a pair differed in, and ranks options it never lost', () => {
    const beliefs = choiceBeliefs(
      fitPreferences([
        {
          first: { x: 'a', y: 'p' },
          second: { x: 'b', y: 'q' },
          outcome: 'win',
          weight: 1,
          eventId: 1
        },
        duel('a', 'c')
      ])
    );
    expect(beliefs.get('x')).toMatchObject({ likeliest: 'a', options: ['a', 'b', 'c'] });
    expect(beliefs.get('y')).toMatchObject({ likeliest: 'p' });
  });

  it('fits a session of answers over many choices in well under a frame budget', () => {
    const duels: Duel[] = Array.from({ length: 60 }, (_, index) => ({
      first: { [`v${index % 30}`]: `o${index % 7}`, [`w${index % 11}`]: 'p' },
      second: { [`v${index % 30}`]: `o${(index + 3) % 7}`, [`w${index % 11}`]: 'q' },
      outcome: index % 5 ? 'win' : 'tie',
      weight: 1,
      eventId: index
    }));
    const started = performance.now();
    const beliefs = choiceBeliefs(fitPreferences(duels));
    expect(performance.now() - started).toBeLessThan(200);
    expect(beliefs.size).toBe(41);
  });
});

describe('the evidence in a project', () => {
  it('counts a preference as a win, either is fine as a tie, and unsure as nothing', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntDots', 'tie');
    answer('IntDots', 'IntTally', 'skip');
    const evidence = preferenceEvidence(events);
    expect(evidence.skipped).toBe(1);
    expect(evidence.duels.map(({ first, second, outcome }) => [first, second, outcome])).toEqual([
      [{ 'views.Int': 'IntTally' }, { 'views.Int': 'IntCell' }, 'win'],
      [{ 'views.Int': 'IntCell' }, { 'views.Int': 'IntDots' }, 'tie']
    ]);
  });

  it('counts only the latest answer to a pair answered again', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'skip');
    const [left, right] = ['p1', 'p2'];
    const again = (payload: object) =>
      events.push({
        id: events.length + 1,
        type: 'visualization.preference-recorded',
        payload: { presentations: [right, left], ...payload }
      } as unknown as ProjectEvent);
    again({ preferred: right });
    again({ preferred: left });
    const evidence = preferenceEvidence(events);
    expect(evidence.skipped).toBe(0);
    expect(evidence.duels.map(({ first, eventId }) => [first, eventId])).toEqual([
      [{ 'views.Int': 'IntCell' }, 5]
    ]);
  });

  it('takes a vary decision as strong evidence against every other option seen', () => {
    const { events, answer, vary } = project();
    answer('IntCell', 'IntTally', 'left');
    vary('views.Int', 'IntTally');
    const evidence = preferenceEvidence(events);
    expect(evidence.fixes).toEqual([{ variable: 'views.Int', value: 'IntTally', eventId: 4 }]);
    expect(evidence.duels.at(-1)).toMatchObject({
      first: { 'views.Int': 'IntTally' },
      second: { 'views.Int': 'IntCell' },
      weight: 3
    });
  });
});

describe('settling', () => {
  it('settles once one option is very likely best over two answers, not one', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'right');
    expect(stateOf(events)).toMatchObject({ state: 'open', likeliest: 'IntTally', answers: 1 });
    answer('IntCell', 'IntTally', 'right');
    expect(stateOf(events)).toMatchObject({ state: 'settled', value: 'IntTally', answers: 2 });
  });

  it('reopens a settled choice when later answers disagree', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntTally', 'left');
    expect(stateOf(events)).toMatchObject({ state: 'open' });
  });

  it('makes a choice either while either is fine is its latest answer', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntTally', 'tie');
    expect(stateOf(events)).toMatchObject({ state: 'either', value: 'IntCell' });
    answer('IntCell', 'IntTally', 'right');
    expect(stateOf(events)?.state).not.toBe('either');
  });

  it('fixes a vary decision’s value until an answer goes against it', () => {
    const { events, answer, vary } = project();
    answer('IntCell', 'IntTally', 'left');
    vary('views.Int', 'IntTally');
    expect(stateOf(events)).toMatchObject({ state: 'settled', value: 'IntTally' });
    answer('IntCell', 'IntTally', 'right');
    expect(stateOf(events)).toMatchObject({ state: 'settled', value: 'IntTally' });
    answer('IntCell', 'IntTally', 'left');
    answer('IntCell', 'IntTally', 'left');
    expect(stateOf(events)?.value).not.toBe('IntTally');
  });

  it('gives each answer the values it newly settled, for setting aside moot comparisons', () => {
    const { events, answer } = project();
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntTally', 'right');
    answer('IntCell', 'IntTally', 'skip');
    expect(answersAfter(events, 0)).toEqual([
      { eventId: 3, settled: {}, pair: [{ 'views.Int': 'IntCell' }, { 'views.Int': 'IntTally' }] },
      {
        eventId: 6,
        settled: { 'views.Int': 'IntTally' },
        pair: [{ 'views.Int': 'IntCell' }, { 'views.Int': 'IntTally' }]
      }
    ]);
  });
});
