import { describe, expect, it } from 'vitest';

import { briefKeys, type BriefItem, type BriefKey } from '$lib/shared/projects/brief';
import type { ProjectEvent } from '$lib/shared/projects/events';

import { briefContext, briefSteering, questionsSinceShown } from './brief-context';
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
      expect.objectContaining({ key: 'focus', prompt: 'ask', first: true })
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
  const count = (events: object[]) => questionsSinceShown(events as ProjectEvent[]);

  it('counts the questions asked since anything was last shown', () => {
    expect(count([])).toBe(0);
    // A first version, its reply asking who it is for: one question since it showed.
    expect(count([shown, asked])).toBe(1);
    expect(count([shown, asked, replied, asked])).toBe(2);
    expect(count([shown, asked, shown, replied])).toBe(0);
  });

  it('shows next once a question in words has been asked since', () => {
    const algorithm = { status: 'confirmed', value: 'breadth-first search' } as const;
    expect(briefContext(brief({ algorithm }), [], 0)).not.toHaveProperty('next');
    expect(briefContext(brief({ algorithm }), [], 1)).toMatchObject({ next: 'show' });
  });
});
