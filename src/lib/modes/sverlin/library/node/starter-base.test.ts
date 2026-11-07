import { describe, expect, it } from 'vitest';

import { isToken, missingRoleLooks, roleProps, tokenProps, type KindRole } from './design';
import { starterBase } from './starter-base';

describe('the starter base', () => {
  it('sets every role’s look, as the engine holds none of its own', () => {
    const roles = Object.fromEntries(
      (Object.keys(roleProps) as KindRole[]).map((role) => [role, role])
    );
    expect(missingRoleLooks(starterBase, roles)).toEqual([]);
  });

  it('holds every token and names itself', () => {
    for (const token of Object.keys(tokenProps))
      expect(isToken(token) && starterBase[token]).toBeDefined();
    expect(starterBase.base).toBe('$starter');
  });
});
