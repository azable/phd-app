import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';
import type { Annotation } from '$lib/shared/projects/events/message-content';

import { annotationPins, sentAnnotations, VisualAnnotations } from './visual-annotations.svelte';

const first = '12345678-1234-4123-8123-123456789ac1';
const second = '12345678-1234-4123-8123-123456789ac2';
const comment = (presentationId: string, step: number, text: string, extra = {}): Annotation => ({
  type: 'annotation',
  presentationId,
  step,
  text,
  ...extra
});

describe('comment pins', () => {
  const sent = [
    comment(first, 0, 'Bigger cells', { elements: [{ id: '4:3#1', label: '7' }] }),
    comment(second, 0, 'Fine as it is'),
    comment(first, 2, 'Label the target', { point: { x: 40, y: 12 } })
  ];

  it('number a presentation’s comments in the order made, drafts after those sent', () => {
    const drafts = [comment(first, 2, 'And the index')];
    expect(annotationPins(first, 2, sent, drafts)).toEqual([
      { n: 2, point: { x: 40, y: 12 }, text: 'Label the target' },
      { n: 3, text: 'And the index', draft: true }
    ]);
    expect(annotationPins(first, 0, sent, drafts)).toEqual([
      { n: 1, elements: ['4:3#1'], text: 'Bigger cells' }
    ]);
    expect(annotationPins(second, 2, sent, drafts)).toEqual([]);
  });

  it('highlight the comment pointed at in the chat', () => {
    expect(annotationPins(first, 2, sent, [], sent[2])).toEqual([
      { n: 2, point: { x: 40, y: 12 }, text: 'Label the target', highlighted: true }
    ]);
  });

  it('come back from the messages and answers that sent them', () => {
    const events = [
      {
        type: 'feedback.submitted',
        payload: { content: [{ type: 'markdown', text: 'Two notes' }, sent[0]], focus: [] }
      },
      {
        type: 'visualization.preference-recorded',
        payload: { presentations: [first, second], step: 0, preferred: first, comment: [sent[2]] }
      },
      { type: 'visualization.preference-recorded', payload: { outcome: 'tie' } }
    ] as unknown as ProjectEvent[];
    expect(sentAnnotations(events)).toEqual([sent[0], sent[2]]);
  });

  it('stay drafts until a message on their presentation takes them', () => {
    const annotations = new VisualAnnotations();
    const mine = comment(first, 0, 'Too tight');
    const other = comment(second, 1, 'Nice');
    annotations.add(mine);
    annotations.add(other);
    expect(annotations.take([first])).toEqual([mine]);
    expect(annotations.drafts).toEqual([other]);
    annotations.remove(other);
    expect(annotations.drafts).toEqual([]);
  });
});
