import { describe, expect, it } from 'vitest';

import { participantPurgeConfirmation, purgeAllProjects } from './research-data-lifecycle';

describe('research data verification', () => {
  it('requires an exact participant-specific purge confirmation', () => {
    expect(participantPurgeConfirmation('P-104')).toBe('DELETE P-104');
  });

  it('deletes no project without the exact confirmation', async () => {
    await expect(purgeAllProjects('DELETE ALL')).rejects.toThrow(
      'Enter DELETE ALL PROJECTS to confirm deleting every project.'
    );
  });
});
