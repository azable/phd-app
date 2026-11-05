import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import VariantControls from './VariantControls.svelte';

const session = { atHead: true, pending: undefined, runCommand: async () => true };

describe('VariantControls', () => {
  it('says New pair in a comparison', () => {
    const { body } = render(VariantControls, { props: { session, layout: 'comparison' } as never });
    expect(body).toContain('New pair');
    expect(body).not.toContain('Chooser');
  });

  it('says Another variant when one presentation shows', () => {
    const { body } = render(VariantControls, { props: { session, layout: 'single' } as never });
    expect(body).toContain('Another variant');
  });
});
