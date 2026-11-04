import { describe, expect, it } from 'vitest';

import {
  fallbackPresentationName,
  namedPresentations,
  presentationName
} from './presentation-names';
import type { RenderablePresentation } from './presentations';
import type { ProjectEvent } from './projects/events';

const bundle = (variant: Record<string, unknown>) =>
  ({
    presentationId: 'presentation-1',
    format: 'browser-bundle-v1',
    source: { text: 'source', sha256: `3fa2c1${'0'.repeat(58)}`, mediaType: 'text/x-svelte' },
    variant
  }) as unknown as RenderablePresentation;

// Computed with the naming code as it was before it moved here, so no name already shown changes.
describe('presentation names', () => {
  it('name a bundle by its source hash and the values its variables took, in any key order', () => {
    expect(presentationName(bundle({}))).toBe('3fa2c1/Calm-Comet-66');
    expect(presentationName(bundle({ 'Row.spacing': 'packed', 'Here.Pointed.expand': 4 }))).toBe(
      '3fa2c1/Silver-Gecko-87'
    );
    expect(presentationName(bundle({ 'Here.Pointed.expand': 4, 'Row.spacing': 'packed' }))).toBe(
      '3fa2c1/Silver-Gecko-87'
    );
  });

  it('name a presentation known only by its id', () => {
    expect(fallbackPresentationName('presentation-1')).toBe('Quiet-Heron-53');
  });

  it('list every presentation a Timeline records, by name', () => {
    const presented = {
      id: 7,
      type: 'visualization.presented',
      operationId: 'op',
      payload: { slot: 0, presentation: bundle({}) }
    } as unknown as ProjectEvent;
    const other = {
      id: 8,
      type: 'operation.completed',
      operationId: 'op'
    } as unknown as ProjectEvent;
    expect(namedPresentations([presented, other])).toEqual([
      { eventId: 7, presentationId: 'presentation-1', name: '3fa2c1/Calm-Comet-66' }
    ]);
  });
});
