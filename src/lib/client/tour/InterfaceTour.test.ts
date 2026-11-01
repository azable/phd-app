import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import InterfaceTour from './InterfaceTour.svelte';

describe('interface tour', () => {
  it('renders only its help button until the page has loaded', () => {
    const { body } = render(InterfaceTour, { props: { mode: 'html', viewer: 'p1', auto: true } });
    expect(body).toContain('aria-label="Interface help"');
    expect(body).toContain('data-interface-part="help"');
    expect(body).not.toContain('role="dialog"');
  });
});
