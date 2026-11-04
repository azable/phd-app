import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { withExampleNames } from './dev-demo-names';

const presented = (operationId: string, variant: Record<string, unknown>) =>
  ({
    id: 1,
    type: 'visualization.presented',
    operationId,
    payload: {
      slot: 0,
      presentation: {
        presentationId: `p-${operationId}`,
        format: 'browser-bundle-v1',
        source: { text: 's', sha256: `3fa2c1${'0'.repeat(58)}`, mediaType: 'text/x-svelte' },
        variant
      }
    }
  }) as unknown as ProjectEvent;

describe('demo names', () => {
  it('name the example each presentation an operation showed was built from, keeping earlier ones', () => {
    const events = [
      presented('a', {}),
      presented('b', { 'Row.spacing': 'packed', 'Here.Pointed.expand': 4 })
    ];
    expect(
      withExampleNames({ 'old/Name-00': '01-first' }, events, 'b', '19-expand-packed')
    ).toEqual({
      'old/Name-00': '01-first',
      '3fa2c1/Silver-Gecko-87': '19-expand-packed'
    });
  });
});
