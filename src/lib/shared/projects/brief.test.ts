import { describe, expect, it } from 'vitest';

import {
  briefAttribute,
  briefAttributes,
  briefKeys,
  intakeKeys,
  projectBrief,
  type BriefAttribute
} from './brief';
import type { ProjectEvent } from './events';

const families = ['views', 'shown', 'arrangement', 'shape', 'lettering', 'colour', 'spacing'];

function responded(id: number, payload: object): ProjectEvent {
  return {
    id,
    type: 'assistant.responded',
    payload: { content: [{ type: 'markdown', text: 'Reply' }], ...payload }
  } as unknown as ProjectEvent;
}

function said(id: number, text: string): ProjectEvent {
  return {
    id,
    type: 'feedback.submitted',
    payload: { content: [{ type: 'markdown', text }], focus: [] }
  } as unknown as ProjectEvent;
}

describe('the brief’s attributes', () => {
  it('starts with intake’s questions, then Stage 5’s attributes, each asked and explained', () => {
    expect(briefKeys).toEqual([
      'algorithm',
      'audience',
      'focus',
      'vocabulary',
      'setting',
      'use',
      'detail',
      'constraints',
      'tone',
      'cases',
      'questions',
      'lead'
    ]);
    expect(briefKeys.slice(0, intakeKeys.length)).toEqual(intakeKeys);
    for (const attribute of briefAttributes as readonly BriefAttribute[]) {
      expect(attribute.question).toMatch(/\?/u);
      expect(attribute.why.length).toBeGreaterThan(0);
      if (Array.isArray(attribute.bearsOn))
        for (const family of attribute.bearsOn) expect(families).toContain(family);
      for (const steer of Object.values(attribute.tags ?? {}))
        for (const family of [
          ...Object.keys(steer.families ?? {}),
          ...(steer.excludes?.families ?? [])
        ])
          expect(families).toContain(family);
    }
    expect(
      (briefAttributes as readonly BriefAttribute[]).find(({ key }) => key === 'cases')
    ).toMatchObject({ bearsOn: 'inputs' });
  });

  it('asks for the intended learning outcome, tagging its verb and the misconception', () => {
    const focus = briefAttribute('focus');
    expect(focus.question).toBe(
      'To help me focus it, what should students be able to do after seeing this — for example, an intended learning outcome from your subject?'
    );
    expect(focus).toMatchObject({ askFirst: true, asked: 'both' });
    expect(focus.intake).toBeUndefined();
    const tags = focus.tags ?? {};
    expect(Object.keys(tags)).toEqual(
      expect.arrayContaining(['notice', 'trace', 'explain', 'compare', 'apply', 'misconception'])
    );
    for (const verb of ['notice', 'trace', 'explain', 'compare', 'apply']) {
      const steered = Object.keys(tags[verb].families ?? {});
      expect(steered.length).toBeGreaterThan(0);
      for (const family of steered) expect(focus.bearsOn).toContain(family);
    }
  });
});

describe('the brief from the events', () => {
  it('leaves every attribute unknown until something sets it', () => {
    expect(projectBrief([]).map(({ status }) => status)).toEqual(briefKeys.map(() => 'unknown'));
  });

  it('confirms intake’s answer in the participant’s words', () => {
    const brief = projectBrief([
      responded(3, { intakeStep: 'algorithm' }),
      said(4, 'Insertion sort, please'),
      said(5, 'Make it big')
    ]);
    expect(brief[0]).toEqual({
      key: 'algorithm',
      status: 'confirmed',
      value: 'Insertion sort, please',
      source: 'Insertion sort, please',
      eventId: 4
    });
  });

  it('forgets an intake answer that left intake instead', () => {
    const brief = projectBrief([
      responded(3, { intakeStep: 'algorithm' }),
      said(4, 'Skip this, just start'),
      {
        id: 5,
        type: 'assistant.intake-completed',
        payload: { interactionEventId: 4, outcome: 'waived' }
      } as unknown as ProjectEvent
    ]);
    expect(brief[0]).toEqual({ key: 'algorithm', status: 'unknown' });
  });

  it('records what decisions set, the latest standing, with the words it came from', () => {
    const brief = projectBrief([
      responded(3, {
        brief: [
          {
            key: 'audience',
            value: 'first-year students',
            status: 'inferred',
            source: 'for my first-years',
            tags: ['novice', 'bold']
          },
          { key: 'constraints', value: 'prints in grey', status: 'inferred', tags: ['greyscale'] }
        ]
      }),
      responded(5, {
        brief: [
          { key: 'audience', value: 'first-year students', status: 'confirmed', tags: ['novice'] },
          { key: 'constraints', value: '', status: 'unknown' }
        ]
      })
    ]);
    const byKey = Object.fromEntries(brief.map((item) => [item.key, item]));
    expect(byKey.audience).toEqual({
      key: 'audience',
      status: 'confirmed',
      value: 'first-year students',
      tags: ['novice'],
      eventId: 5
    });
    expect(byKey.constraints).toEqual({ key: 'constraints', status: 'unknown' });
    // A tag another attribute names is dropped.
    expect(
      projectBrief([
        responded(3, {
          brief: [{ key: 'audience', value: 'x', status: 'inferred', tags: ['bold'] }]
        })
      ]).find(({ key }) => key === 'audience')
    ).not.toHaveProperty('tags');
  });
});

describe('an attribute asked by showing', () => {
  const side = (id: number, presentationId: string, label: string, tag: string) =>
    ({
      id,
      type: 'visualization.presented',
      payload: {
        presentation: { presentationId },
        question: 'Which look suits your course?',
        label,
        brief: { key: 'tone', tag }
      }
    }) as unknown as ProjectEvent;
  const pair = [side(3, 'a', 'academic', 'restrained'), side(4, 'b', 'bolder', 'bold')];
  const answer = (payload: object) =>
    ({
      id: 5,
      type: 'visualization.preference-recorded',
      payload: { presentations: ['a', 'b'], step: 0, ...payload }
    }) as unknown as ProjectEvent;
  const tone = (events: ProjectEvent[]) => projectBrief(events).find(({ key }) => key === 'tone');

  it('is set by the side picked, as inferred from the pick', () => {
    expect(tone([...pair, answer({ preferred: 'b' })])).toEqual({
      key: 'tone',
      status: 'inferred',
      value: 'bolder',
      source: 'Which look suits your course? → bolder',
      tags: ['bold'],
      eventId: 5
    });
  });

  it('is left as it was by either is fine and unsure', () => {
    expect(tone([...pair, answer({ outcome: 'tie' })])).toEqual({ key: 'tone', status: 'unknown' });
    expect(tone([...pair, answer({ outcome: 'skip' })])).toEqual({
      key: 'tone',
      status: 'unknown'
    });
  });
});
