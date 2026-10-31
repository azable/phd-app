import { describe, expect, it } from 'vitest';

import { withDevChooser } from './chooser-config';

describe('withDevChooser', () => {
  const resample = { type: 'resample', presentationCount: 2, chooser: 'random' } as const;

  it('honours a resample’s chooser from an administrator', () => {
    expect(withDevChooser(resample, true)).toEqual(resample);
  });

  it('drops it from anyone else, who gets the configured chooser', () => {
    expect(withDevChooser(resample, false)).toEqual({ type: 'resample', presentationCount: 2 });
  });

  it('leaves other commands as they are', () => {
    const rename = { type: 'rename', title: 'x' };
    expect(withDevChooser(rename, false)).toBe(rename);
  });
});
