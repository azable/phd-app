import { describe, expect, it } from 'vitest';

import type { TimelinePresentation } from './presentation-history';
import {
  localPresentationStep,
  presentationHeld,
  presentationPlaybackContext,
  PresentationPlayback
} from './presentation-playback.svelte';

describe('presentation playback', () => {
  it('retains the selected step across seeded views of the same component', () => {
    const playback = new PresentationPlayback();
    const first = presentationPlaybackContext([presentation(1, 'a'.repeat(64), 4)]);
    const second = presentationPlaybackContext([presentation(2, 'a'.repeat(64), 4)]);
    playback.activate(first);
    playback.seek(first, 2);
    playback.activate(second);
    expect(second.key).toBe(first.key);
    expect(playback.stepFor(second)).toBe(2);
  });

  it('clamps on fewer steps and resets for a different source', () => {
    const playback = new PresentationPlayback();
    const first = presentationPlaybackContext([presentation(1, 'a'.repeat(64), 4)]);
    const shorter = presentationPlaybackContext([presentation(2, 'a'.repeat(64), 2)]);
    playback.activate(first);
    playback.seek(first, 3);
    playback.activate(shorter);
    expect(playback.stepFor(shorter)).toBe(1);
    const other = presentationPlaybackContext([presentation(3, 'b'.repeat(64), 3)]);
    playback.activate(other);
    expect(playback.stepFor(other)).toBe(0);
  });

  it('returns to a source at the step it was last left at', () => {
    const playback = new PresentationPlayback();
    const first = presentationPlaybackContext([presentation(1, 'a'.repeat(64), 4)]);
    const other = presentationPlaybackContext([presentation(2, 'b'.repeat(64), 4)]);
    playback.activate(first);
    playback.seek(first, 2);
    playback.activate(other);
    expect(playback.stepFor(first)).toBe(2);
    playback.activate(first);
    expect(playback.stepFor(first)).toBe(2);
  });

  it('maps one shared position to each visible presentation', () => {
    const left = presentation(1, 'a'.repeat(64), 3);
    const right = presentation(2, 'a'.repeat(64), 3);
    const context = presentationPlaybackContext([left, right]);
    expect(context.frames.map(({ label }) => label)).toEqual(['Step 1', 'Step 2', 'Step 3']);
    expect(localPresentationStep(context, left.presentation.presentationId, 2)).toBe(2);
    expect(localPresentationStep(context, right.presentation.presentationId, 2)).toBe(2);
  });

  it('aligns steps by their names among the source’s, holding the previous step where one is omitted', () => {
    const steps = [['Start'], ['Compare 0'], ['Compare 1'], ['Found']];
    const fine = aligned(1, ['Start', 'Compare 0', 'Compare 1', 'Found'], steps);
    const coarse = aligned(2, ['Start', 'Compare 1', 'Found'], steps);
    const context = presentationPlaybackContext([fine, coarse]);
    expect(context.frames.map(({ label }) => label)).toEqual([
      'Start',
      'Compare 0',
      'Compare 1',
      'Found'
    ]);
    const coarseId = coarse.presentation.presentationId;
    expect([0, 1, 2, 3].map((step) => localPresentationStep(context, coarseId, step))).toEqual([
      0, 0, 1, 2
    ]);
    expect([0, 1, 2, 3].map((step) => presentationHeld(context, coarseId, step))).toEqual([
      false,
      true,
      false,
      false
    ]);
    expect(presentationHeld(context, fine.presentation.presentationId, 1)).toBe(false);
  });

  it('opens a pair at the first step its sides differ, only the first time it is shown', () => {
    const playback = new PresentationPlayback();
    const differing = (id: number) => ({
      ...presentation(id, 'a'.repeat(64), 6),
      differsAt: [2, 3]
    });
    const pair = presentationPlaybackContext([differing(1), differing(2)]);
    expect(pair.differsAt).toEqual([2, 3]);
    expect(playback.stepFor(pair)).toBe(2);
    playback.activate(pair);
    expect(playback.stepFor(pair)).toBe(2);
    playback.seek(pair, 5);
    const single = presentationPlaybackContext([presentation(3, 'a'.repeat(64), 6)]);
    playback.activate(single);
    playback.activate(pair);
    expect(playback.stepFor(pair)).toBe(5);
    // A pair never shown opens at its own first difference.
    const other = presentationPlaybackContext([differing(4), differing(5)]);
    playback.activate(other);
    expect(playback.stepFor(other)).toBe(2);
    // Shown again from its comparison, a pair opens at its first difference again.
    playback.activate(pair);
    playback.openAtFirstDifference(pair);
    expect(playback.stepFor(pair)).toBe(2);
  });

  it('counts a pair’s differences in shared steps where one side omits a step', () => {
    const steps = [['Start'], ['A'], ['B'], ['End']];
    const fine = { ...aligned(1, ['Start', 'A', 'B', 'End'], steps), differsAt: [2] };
    const coarse = { ...aligned(2, ['Start', 'B', 'End'], steps), differsAt: [2] };
    expect(presentationPlaybackContext([fine, coarse]).differsAt).toEqual([2]);
    expect(presentationPlaybackContext([fine]).differsAt).toBeUndefined();
  });

  it('aligns a step by any of its names, as nested labels ending together give it', () => {
    const steps = [['start'], ['@scan#1', '@scan.check#1'], ['end']];
    const outer = aligned(1, ['start', '@scan#1', 'end'], steps);
    const inner = aligned(2, ['start', '@scan.check#1', 'end'], steps);
    const context = presentationPlaybackContext([outer, inner]);
    expect(context.stepCount).toBe(3);
    expect(context.frames.every(({ held }) => held.length === 0)).toBe(true);
  });

  it('refuses to show presentations of two sources, or steps not their source’s, together', () => {
    const steps = [['A'], ['B'], ['C']];
    const left = aligned(1, ['A', 'B', 'C'], steps);
    const right = aligned(2, ['A', 'B'], steps);
    right.presentation = { ...right.presentation, stepSignature: 'other' };
    expect(() => presentationPlaybackContext([left, right])).toThrow(/one source/u);
    expect(() => presentationPlaybackContext([left, aligned(3, ['A', 'D'], steps)])).toThrow(
      /not its source/u
    );
    expect(() => presentationPlaybackContext([left, aligned(4, ['B', 'A'], steps)])).toThrow(
      /not its source/u
    );
  });
});

function aligned(id: number, labels: string[], steps: string[][]): TimelinePresentation {
  const entry = presentation(id, 'a'.repeat(64), labels.length);
  if (entry.presentation.format !== 'browser-bundle-v1') throw new Error('Expected a bundle.');
  return { ...entry, presentation: { ...entry.presentation, labels, steps } };
}

function presentation(id: number, sourceSha256: string, stepCount: number): TimelinePresentation {
  return {
    eventId: id,
    eventType: 'visualization.presented',
    operationId: '12345678-1234-4123-8123-123456789abc',
    slot: 0,
    presentation: {
      presentationId: `12345678-1234-4123-8123-${String(id).padStart(12, '0')}`,
      format: 'browser-bundle-v1',
      mode: 'sverlin',
      stepSignature: 'same-source',
      labels: Array.from({ length: stepCount }, (_, step) => `Step ${step + 1}`),
      steps: Array.from({ length: stepCount }, (_, step) => [`Step ${step + 1}`]),
      seed: id,
      source: { text: 'component', sha256: sourceSha256, mediaType: 'text/x-svelte' },
      html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
      javascript: {
        text: 'void 0;',
        sha256: String(id).repeat(64).slice(0, 64),
        mediaType: 'text/javascript'
      }
    }
  };
}
