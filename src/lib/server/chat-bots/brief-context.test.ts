import { describe, expect, it } from 'vitest';

import { briefKeys, type BriefItem, type BriefKey } from '$lib/shared/projects/brief';
import type { ProjectEvent } from '$lib/shared/projects/events';

import { briefContext, briefSteering, conversationState } from './brief-context';
import { openChoices, preferenceSummary } from './preference-summary';
import type { AiDesign } from './project-context';

const design: AiDesign = {
  options: { fill: ['none', 'white', 'amber-200', 'sky-200'], font: ['sans', 'serif', 'mono'] },
  variables: [
    { variable: 'Compared.fill', options: 'fill', value: 'white' },
    { variable: 'Cell.fill', options: 'fill', value: 'white' },
    { variable: 'Cell.font', options: 'font', value: 'sans' },
    { variable: 'pause@insert.swap', options: ['on', 'off'], value: 'on' },
    { variable: 'listing.language', options: ['python', 'pseudo'], value: 'pseudo' }
  ]
};

/** A brief with the given attributes set, the rest unknown. */
function brief(
  set: Partial<Record<BriefKey, Omit<Extract<BriefItem, { value: string }>, 'key' | 'eventId'>>>
) {
  return briefKeys.map((key): BriefItem => {
    const item = set[key];
    return item ? { key, eventId: 1, ...item } : { key, status: 'unknown' };
  });
}

const askNext = (items: BriefItem[]) =>
  preferenceSummary([], design, briefSteering(items))!.askNext.flatMap(
    ({ variables }) => variables
  );

describe('the brief steering the preference summary', () => {
  it('ranks how comparisons are marked above fonts when the focus is comparisons', () => {
    expect(askNext(brief({})).indexOf('Cell.font')).toBeLessThan(
      askNext(brief({})).indexOf('Compared.fill')
    );
    const focused = brief({
      focus: { status: 'inferred', value: 'each comparison', tags: ['comparisons'] }
    });
    const steering = briefSteering(focused);
    expect(steering.weight('Compared.fill')).toBeGreaterThan(1);
    expect(steering.weight('Cell.font')).toBeLessThan(1);
    expect(steering.weight('Cell.fill')).toBe(1);
    const ranked = askNext(focused);
    expect(ranked.indexOf('Compared.fill')).toBeLessThan(ranked.indexOf('Cell.font'));
  });

  it('steers by the intended learning outcome’s verb', () => {
    const outcome = (verb: string) =>
      briefSteering(
        brief({
          focus: {
            status: 'inferred',
            value: 'trace insertion sort on a small list',
            source: 'Students will be able to trace insertion sort on a small list',
            tags: [verb]
          }
        })
      );
    expect(outcome('trace').weight('pause@insert.swap')).toBeGreaterThan(1);
    expect(outcome('apply').weight('pause@insert.swap')).toBe(1);
    expect(outcome('notice').weight('Cell.fill')).toBeGreaterThan(1);
    expect(outcome('explain').weight('Cell.font')).toBe(
      briefSteering(brief({})).weight('Cell.font')
    );
    const focus = briefContext(brief({}), []).attributes.find(({ key }) => key === 'focus');
    expect(focus?.question).toMatch(/what should students be able to do after seeing this/u);
    expect(focus?.offeredTags).toEqual(
      expect.arrayContaining(['notice', 'trace', 'explain', 'compare', 'apply', 'misconception'])
    );
  });

  it('multiplies every value’s weights', () => {
    const steering = briefSteering(
      brief({
        detail: { status: 'confirmed', value: 'only key steps', tags: ['key-steps'] },
        setting: { status: 'inferred', value: 'revising', tags: ['revision'] }
      })
    );
    expect(steering.weight('pause@insert.swap')).toBeCloseTo(1.6 * 0.7);
  });

  it('keeps colours out of what is worth asking and of comparisons when it prints in grey', () => {
    const grey = brief({
      constraints: { status: 'confirmed', value: 'printed in grey', tags: ['greyscale'] }
    });
    const steering = briefSteering(grey);
    expect(steering.excluded('Cell.fill')).toBe('it must print in grey');
    expect(steering.excluded('Cell.font')).toBeUndefined();
    const summary = preferenceSummary([], design, steering)!;
    expect(summary.askNext.map(({ family }) => family)).not.toContain('colour');
    expect(summary.unexplored.map(({ family }) => family)).not.toContain('colour');
    expect(
      briefSteering(
        brief({ constraints: { status: 'inferred', value: 'no code', tags: ['no-listing'] } })
      ).excluded('listing.language')
    ).toBe('it has no code listing');
  });
});

describe('the brief in the assistant’s context', () => {
  const open = openChoices([], design);

  it('assumes a restrained look while the tone is unknown, steering as if it were said', () => {
    const unknown = briefContext(brief({}), open).attributes.find(({ key }) => key === 'tone');
    expect(unknown).toMatchObject({ status: 'unknown', assumed: 'restrained' });
    expect(briefSteering(brief({})).weight('Cell.font')).toBeCloseTo(0.8);
    const bold = brief({ tone: { status: 'confirmed', value: 'bolder', tags: ['bold'] } });
    expect(briefSteering(bold).weight('Cell.font')).toBeCloseTo(1.4);
    expect(
      briefContext(bold, open).attributes.find(({ key }) => key === 'tone')
    ).not.toHaveProperty('assumed');
  });

  it('offers to show what a picture answers, and to ask in words the rest', () => {
    const byKey = Object.fromEntries(
      briefContext(brief({}), open).attributes.map((item) => [item.key, item])
    );
    // The look is asked by a comparison, the side picked setting it.
    expect(byKey.tone).toMatchObject({
      prompt: 'show',
      asked: 'showing',
      decides: ['lettering', 'colour']
    });
    // A label’s wording shown, other terms in words; what stands out shown, the misconception in words.
    expect(byKey.vocabulary).toMatchObject({ prompt: 'ask', asked: 'both', decides: ['views'] });
    expect(byKey.focus).toMatchObject({ prompt: 'ask', asked: 'both', first: true });
    expect(byKey.audience).toMatchObject({ prompt: 'ask' });
    expect(byKey.audience).not.toHaveProperty('asked');
  });

  it('asks about low vision and printing once, late, after the other questions', () => {
    const algorithm = { status: 'confirmed', value: 'insertion sort' } as const;
    const audience = { status: 'confirmed' as const, value: 'first-years', tags: ['novice'] };
    const focus = { status: 'confirmed' as const, value: 'each comparison', tags: ['comparisons'] };
    const context = briefContext(brief({ algorithm, audience, focus }), open);
    expect(context.attributes.find(({ key }) => key === 'constraints')).toMatchObject({
      prompt: 'ask',
      later: true
    });
    expect(context.askFirst).not.toContain('constraints');
    const rest = briefContext(
      brief({
        algorithm,
        audience,
        focus,
        vocabulary: { status: 'confirmed', value: 'the code’s names' },
        setting: { status: 'confirmed', value: 'a lecture' },
        use: { status: 'confirmed', value: 'slides' },
        detail: { status: 'confirmed', value: 'every step' },
        tone: { status: 'confirmed', value: 'restrained', tags: ['restrained'] }
      }),
      open
    );
    expect(rest.askFirst).toEqual(['constraints']);
  });

  it('marks unknown attributes bearing on open choices to ask, the subject first', () => {
    const context = briefContext(brief({}), open);
    const byKey = Object.fromEntries(context.attributes.map((item) => [item.key, item]));
    expect(byKey.algorithm).toMatchObject({ status: 'unknown', prompt: 'ask' });
    expect(byKey.constraints).toMatchObject({ prompt: 'ask', decides: ['colour', 'views'] });
    expect(byKey.tone.decides).toEqual(['lettering', 'colour']);
    // Edge cases are asked once the first version is settled, as assistant.md says.
    expect(byKey.cases).not.toHaveProperty('prompt');
    expect(context.askFirst.slice(0, 2)).toEqual(['algorithm', 'audience']);
    expect(context.askFirst).toHaveLength(3);
    expect(context.avoid).toEqual([]);
  });

  it('asks nothing of an attribute whose choices are all decided, but who it is for and the takeaway', () => {
    const context = briefContext(
      brief({ algorithm: { status: 'confirmed', value: 'insertion sort' } }),
      []
    );
    expect(context.attributes.filter(({ prompt }) => prompt)).toEqual([
      expect.objectContaining({ key: 'audience', prompt: 'ask', first: true }),
      expect.objectContaining({ key: 'focus', prompt: 'ask', first: true }),
      // Whether to suggest alternatives, asked with the first offered.
      expect.objectContaining({ key: 'lead', prompt: 'ask', withAlternatives: true })
    ]);
    expect(context.attributes.find(({ key }) => key === 'audience')).not.toHaveProperty('decides');
    // Asked in the attributes' order, one at a time.
    expect(context.askFirst).toEqual(['audience', 'focus']);
  });

  it('puts who it is for, while unknown, before every other question, whatever they bear on', () => {
    const algorithm = { status: 'confirmed', value: 'linear search' } as const;
    // Only a colour is open, worth much, which who it is for does not bear on.
    const weighted = [{ variable: 'Cell.fill', family: 'colour' as const, worth: 10 }];
    const context = briefContext(brief({ algorithm }), weighted);
    expect(context.askFirst[0]).toBe('audience');
    expect(context.attributes.find(({ key }) => key === 'audience')).toMatchObject({
      prompt: 'ask',
      first: true
    });
    expect(context.attributes.find(({ key }) => key === 'constraints')).not.toHaveProperty('first');
    // Once the request says who it is for, it is not asked first.
    const said = briefContext(
      brief({
        algorithm,
        audience: { status: 'inferred', value: 'first-years', tags: ['novice'] }
      }),
      weighted
    );
    expect(said.askFirst[0]).not.toBe('audience');
    expect(said.attributes.find(({ key }) => key === 'audience')).not.toHaveProperty('first');
  });

  it('has the first reply ask the takeaway when the request already said who it is for', () => {
    const request = brief({
      algorithm: { status: 'inferred', value: 'linear search', source: 'Linear search' },
      audience: {
        status: 'inferred',
        value: 'beginner programming students',
        source: 'beginner programming students',
        tags: ['novice']
      }
    });
    // Before the first version: nothing shown, nothing asked.
    const context = briefContext(request, open, conversationState([]));
    expect(context).not.toHaveProperty('next');
    expect(context.askFirst[0]).toBe('focus');
    expect(context.attributes.find(({ key }) => key === 'focus')).toMatchObject({
      prompt: 'ask',
      first: true
    });
  });

  it('marks an inferred value that steers open choices to confirm, after unknowns', () => {
    const context = briefContext(
      brief({
        algorithm: { status: 'confirmed', value: 'insertion sort' },
        constraints: {
          status: 'inferred',
          value: 'printed handouts',
          source: 'for the printed handouts',
          tags: ['greyscale']
        },
        tone: { status: 'inferred', value: 'serious', tags: [] }
      }),
      open
    );
    const byKey = Object.fromEntries(context.attributes.map((item) => [item.key, item]));
    expect(byKey.constraints).toMatchObject({
      status: 'inferred',
      value: 'printed handouts',
      source: 'for the printed handouts',
      prompt: 'confirm',
      decides: ['colour']
    });
    // Inferred, but naming nothing that steers.
    expect(byKey.tone).not.toHaveProperty('prompt');
    // Unknowns bearing on open choices come first.
    expect(context.askFirst).not.toContain('constraints');
    expect(context.avoid).toEqual(['colours: it must print in grey']);
  });
});

describe('at most one question in words between things shown', () => {
  const shown = { type: 'visualization.presented', payload: {} };
  const asked = { type: 'assistant.responded', payload: { question: { text: 'Who is it for?' } } };
  const replied = { type: 'assistant.responded', payload: {} };
  const count = (events: object[]) =>
    conversationState(events as ProjectEvent[]).questionsSinceShown;

  it('counts the questions asked since anything was last shown', () => {
    expect(count([])).toBe(0);
    // A first version, its reply asking who it is for: one question since it showed.
    expect(count([shown, asked])).toBe(1);
    expect(count([shown, asked, replied, asked])).toBe(2);
    expect(count([shown, asked, shown, replied])).toBe(0);
  });

  it('shows next once a question in words has been asked since', () => {
    const algorithm = { status: 'confirmed', value: 'breadth-first search' } as const;
    const state = (questionsSinceShown: number) => ({ questionsSinceShown, compared: false });
    expect(briefContext(brief({ algorithm }), [], state(0))).not.toHaveProperty('next');
    expect(briefContext(brief({ algorithm }), [], state(1))).toMatchObject({ next: 'show' });
  });
});

describe('how the participant likes to work', () => {
  const open = openChoices([], design);
  const algorithm = { status: 'confirmed' as const, value: 'binary search' };
  const byKey = (context: ReturnType<typeof briefContext>) =>
    Object.fromEntries(context.attributes.map((item) => [item.key, item]));
  const working = (questions: string, lead: string) =>
    brief({
      algorithm,
      questions: { status: 'inferred', value: questions, tags: [questions] },
      lead: { status: 'inferred', value: lead, tags: [lead] }
    });

  it('starts from a draft first and a mix of suggesting and directing', () => {
    const context = briefContext(brief({ algorithm }), open);
    expect(context.working).toEqual({ questions: 'draft-first', lead: 'mix' });
    expect(byKey(context).questions).not.toHaveProperty('prompt');
  });

  it('asks whether to suggest alternatives with the first offered, and not after', () => {
    const first = briefContext(brief({ algorithm }), open, {
      questionsSinceShown: 0,
      compared: false
    });
    expect(byKey(first).lead).toMatchObject({ prompt: 'ask', withAlternatives: true });
    expect(first.askFirst).not.toContain('lead');
    const later = briefContext(brief({ algorithm }), open, {
      questionsSinceShown: 0,
      compared: true
    });
    expect(byKey(later).lead).not.toHaveProperty('prompt');
    const shown = { type: 'visualization.presented', payload: { question: 'Cells or tallies?' } };
    expect(conversationState([shown] as unknown as ProjectEvent[]).compared).toBe(true);
  });

  it('asks nothing a version can be made without when they want fewer questions', () => {
    const context = briefContext(working('fewer-questions', 'mix'), open);
    expect(context.attributes.filter(({ prompt }) => prompt)).toEqual([]);
    expect(context.askFirst).toEqual([]);
    // Only the algorithm, while unknown.
    const none = briefContext(
      brief({
        questions: { status: 'inferred', value: 'just make it', tags: ['fewer-questions'] }
      }),
      open
    );
    expect(none.askFirst).toEqual(['algorithm']);
  });

  it('asks in words when they direct it, and shows what a picture answers when they want suggestions', () => {
    const directed = byKey(briefContext(working('draft-first', 'direct'), open));
    expect(directed.tone).toMatchObject({ prompt: 'ask', asked: 'showing' });
    expect(directed.vocabulary).toMatchObject({ prompt: 'ask' });
    const suggested = byKey(briefContext(working('draft-first', 'suggest'), open));
    expect(suggested.tone).toMatchObject({ prompt: 'show' });
    expect(suggested.vocabulary).toMatchObject({ prompt: 'show', asked: 'both' });
    expect(suggested.focus).toMatchObject({ prompt: 'show', first: true });
  });
});
