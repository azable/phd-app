import { describe, expect, it } from 'vitest';

import {
  groupProps,
  isToken,
  roleStyle,
  starterLooks,
  starterTokens,
  type KindRole
} from './design';
import { starterBase } from './starter-base';

describe('the starter base', () => {
  it('sets every role’s look to the look the starter’s kinds start with, so nothing redraws', () => {
    for (const role of Object.keys(starterLooks) as KindRole[])
      for (const prop of groupProps(role)) {
        const level = starterBase[`${roleStyle(role)}.${prop}`];
        expect(isToken(level) ? starterBase[level] : level, `${role} ${prop}`).toBe(
          starterLooks[role][prop]
        );
      }
  });

  it('holds the starter’s tokens and names itself', () => {
    expect(starterBase).toMatchObject({ ...starterTokens, base: '$starter' });
  });
});
