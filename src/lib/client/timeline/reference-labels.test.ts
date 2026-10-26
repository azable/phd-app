import { describe, expect, it } from 'vitest';

import { presentationDisplayId } from '$lib/client/visualization/presentation-history';
import {
  referenceChipLabel,
  referenceChipTitle,
  singletonReferenceSegments
} from './reference-labels';

describe('presentation reference labels', () => {
  it('labels an element chip compactly, with the full label on hover', () => {
    const reference = (label: string) => ({
      type: 'element-ref' as const,
      presentationId: '12345678-1234-4123-8123-123456789ac1',
      step: 0,
      element: { id: '55:1', label }
    });
    const presentation = presentationDisplayId(reference('').presentationId);
    expect(referenceChipLabel(reference('Int 8'))).toBe(`${presentation} · S1 · Int 8`);
    const long = 'Begin with a one-item sorted prefix Insertion sort';
    expect(referenceChipLabel(reference(long))).toBe(`${presentation} · S1 · Begin with a…`);
    expect(referenceChipLabel(reference('Supercalifragilisticexpialidocious'))).toBe(
      `${presentation} · S1 · Supercalifragilistic…`
    );
    expect(referenceChipTitle(reference(long))).toBe(`${presentation} · step 1 · ${long}`);
  });

  it('retains one actionable chip with a stable participant-facing label', () => {
    const reference = {
      type: 'presentation-ref' as const,
      presentationId: '12345678-1234-4123-8123-123456789ac1'
    };
    expect(singletonReferenceSegments(reference)).toEqual([reference]);
    expect(referenceChipLabel(reference)).toBe(presentationDisplayId(reference.presentationId));
  });

  it('labels a presentation chip with the step it was viewed at', () => {
    const reference = {
      type: 'presentation-ref' as const,
      presentationId: '12345678-1234-4123-8123-123456789ac1',
      step: 2
    };
    const presentation = presentationDisplayId(reference.presentationId);
    expect(referenceChipLabel(reference)).toBe(`${presentation} · S3`);
    expect(referenceChipTitle(reference)).toBe(`${presentation} · step 3`);
  });

  it('keeps a named step’s chip short, its name on hover', () => {
    const reference = {
      type: 'presentation-ref' as const,
      presentationId: '12345678-1234-4123-8123-123456789ac1',
      step: 2,
      stepName: '@insert.swap#1'
    };
    const presentation = presentationDisplayId(reference.presentationId);
    expect(referenceChipLabel(reference)).toBe(`${presentation} · S3`);
    expect(referenceChipTitle(reference)).toBe(`${presentation} · step 3, @insert.swap#1`);
  });
});
