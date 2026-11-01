import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import InterfaceTour from './InterfaceTour.svelte';
import TourOverlay from './TourOverlay.svelte';

describe('interface tour', () => {
  it('renders only its help button until the page has loaded', () => {
    const { body } = render(InterfaceTour, { props: { mode: 'html', viewer: 'p1', auto: true } });
    expect(body).toContain('aria-label="Interface help"');
    expect(body).toContain('data-interface-part="help"');
    expect(body).not.toContain('role="dialog"');
    expect(body).toContain('data-interaction="tour-help"');
  });

  it('names each tour button for the interaction recording', () => {
    const popover = { title: 'Timeline', body: 'Your messages.', count: 3, finish: 'Done' };
    const step = (index: number, dim: boolean) =>
      render(TourOverlay, { props: { dim, popover: { ...popover, index }, onClose() {} } }).body;
    expect(step(0, true)).toContain('data-interaction="tour-next"');
    expect(step(0, true)).toContain('data-interaction="tour-skip"');
    expect(step(2, true)).toContain('data-interaction="tour-done"');
    expect(step(2, false)).toContain('data-interaction="tour-hint-dismiss"');
  });
});
