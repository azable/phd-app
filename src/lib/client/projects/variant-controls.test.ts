import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import VariantControls from './VariantControls.svelte';

const session = { atHead: true, pending: undefined, runCommand: async () => true };

describe('VariantControls', () => {
  it('offers every chooser, starting from the configured one, beside New pair', () => {
    const { body } = render(VariantControls, {
      props: { session, layout: 'comparison', configuredChooser: 'decisions' } as never
    });
    expect(body).toContain('aria-label="Chooser"');
    expect(body).toContain('Decisions API (configured)');
    expect(body).toContain('Random');
    expect(body).toContain('New pair');
  });

  it('says Another variant when one presentation shows', () => {
    const { body } = render(VariantControls, { props: { session, layout: 'single' } as never });
    expect(body).toContain('Another variant');
  });
});
