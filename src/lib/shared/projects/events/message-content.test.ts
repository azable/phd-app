import { describe, expect, it } from 'vitest';

import * as v from 'valibot';

import {
  messageContentSegmentSchema,
  plainMessageText,
  structureKnownPresentationReferences
} from './message-content';

const presentationId = '12345678-1234-4123-8123-123456789ac1';

describe('plain message text', () => {
  it('identifies the retained presentation in plain text', () => {
    expect(
      plainMessageText([
        { type: 'markdown', text: 'Compare' },
        { type: 'presentation-ref', presentationId }
      ])
    ).toBe(`Compare [Presentation ${presentationId}]`);
  });

  it('names the step the participant was viewing it at, counted from 1', () => {
    expect(
      plainMessageText([
        { type: 'markdown', text: 'Viewing' },
        { type: 'presentation-ref', presentationId, step: 2 }
      ])
    ).toBe(`Viewing [Presentation ${presentationId} at step 3]`);
  });

  it('names the step by its label’s run where it has a name, with its number', () => {
    expect(
      plainMessageText([
        { type: 'markdown', text: 'Viewing' },
        { type: 'presentation-ref', presentationId, step: 2, stepName: '@insert.swap#1' },
        {
          type: 'element-ref',
          presentationId,
          step: 2,
          stepName: '@insert.swap#1',
          element: { id: '62:7', label: 'Int 8' }
        }
      ])
    ).toBe(
      `Viewing [Presentation ${presentationId} at @insert.swap#1 (step 3)] [Element "Int 8" (62:7) at @insert.swap#1 (step 3) of presentation ${presentationId}]`
    );
  });

  it('accepts only step names of a label’s run, start, or end', () => {
    const named = (stepName: string) =>
      v.is(messageContentSegmentSchema, {
        type: 'presentation-ref',
        presentationId,
        step: 0,
        stepName
      });
    for (const name of ['start', 'end', '@insert.compare.left#3']) expect(named(name)).toBe(true);
    for (const name of ['Step 1', '@insert.swap #1', 'insert.swap#1', '@insert.swap'])
      expect(named(name)).toBe(false);
  });
});

describe('element references', () => {
  it('identifies the element, step, and presentation in plain text', () => {
    expect(
      plainMessageText([
        { type: 'markdown', text: 'Make this bigger:' },
        {
          type: 'element-ref',
          presentationId,
          step: 2,
          element: { id: '62:7#2', label: 'Int 8' }
        }
      ])
    ).toBe(
      `Make this bigger: [Element "Int 8" (62:7#2) at step 3 of presentation ${presentationId}]`
    );
  });

  it('accepts only well-formed element ids and short labels', () => {
    const reference = (id: string, label = 'Int 8') => ({
      type: 'element-ref',
      presentationId,
      step: 0,
      element: { id, label }
    });
    for (const id of ['62:7', '62:7#2', '56:1/3', '56:1#2/3/0'])
      expect(v.is(messageContentSegmentSchema, reference(id))).toBe(true);
    for (const id of ['', '62', 'a:b', '62:7#', '62:7 ', '<script>'])
      expect(v.is(messageContentSegmentSchema, reference(id))).toBe(false);
    expect(v.is(messageContentSegmentSchema, reference('62:7', 'x'.repeat(121)))).toBe(false);
    expect(v.is(messageContentSegmentSchema, reference('62:7', '  '))).toBe(false);
    const layout = (layouts: unknown) => ({
      ...reference('62:7'),
      element: { id: '62:7', label: 'Int 8', layouts }
    });
    expect(
      v.is(
        messageContentSegmentSchema,
        layout([
          { node: '50:1', seed: 606668785, form: 'snake', curve: 'curved' },
          { node: 'frame', seed: 3 }
        ])
      )
    ).toBe(true);
    for (const bad of [
      [{ node: '50:1', seed: 1, form: 'spiral' }],
      [{ node: 'body', seed: 1 }],
      [{ node: '50:1', seed: 1.5 }]
    ])
      expect(v.is(messageContentSegmentSchema, layout(bad))).toBe(false);
    // References saved before chain was renamed form still load, as a form.
    expect(
      v.parse(messageContentSegmentSchema, layout([{ node: '50:1', seed: 1, chain: 'ring' }]))
    ).toStrictEqual(layout([{ node: '50:1', seed: 1, form: 'ring' }]));
  });
});

describe('known presentation references', () => {
  it('promotes a known UUID, including Markdown code ticks, without changing unknown UUIDs', () => {
    const unknown = '22345678-1234-4234-8234-123456789ac2';
    expect(
      structureKnownPresentationReferences(
        [
          {
            type: 'markdown',
            text: `Prefer \`${presentationId}\` over ${unknown}.`
          }
        ],
        [presentationId]
      )
    ).toEqual([
      { type: 'markdown', text: 'Prefer ' },
      { type: 'presentation-ref', presentationId },
      { type: 'markdown', text: ` over ${unknown}.` }
    ]);
  });
});
