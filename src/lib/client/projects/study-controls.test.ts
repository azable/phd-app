import { describe, expect, it } from 'vitest';

import { shouldShowPhaseExpiredDialog, showsVariantControls } from './study-controls';

describe('study workspace controls', () => {
  it('does not give participant progression controls to an inspecting administrator', () => {
    expect(shouldShowPhaseExpiredDialog(true, 'participant')).toBe(false);
  });

  it('keeps progression controls for participants and admin-owned previews', () => {
    expect(shouldShowPhaseExpiredDialog(false, 'participant')).toBe(true);
    expect(shouldShowPhaseExpiredDialog(true, 'admin-preview')).toBe(true);
  });
});

describe('showsVariantControls', () => {
  it('shows the chooser picker and New pair only in dev mode, for Sverlin, without a buffer', () => {
    expect(showsVariantControls({ developerView: true, mode: 'sverlin', buffered: false })).toBe(
      true
    );
    expect(showsVariantControls({ developerView: false, mode: 'sverlin', buffered: false })).toBe(
      false
    );
    expect(showsVariantControls({ developerView: true, mode: 'html', buffered: false })).toBe(
      false
    );
    expect(showsVariantControls({ developerView: true, mode: 'sverlin', buffered: true })).toBe(
      false
    );
  });
});
