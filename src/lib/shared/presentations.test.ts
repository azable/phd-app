import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import { browserBundlePresentationSchema } from './presentations';

describe('scripted presentation contract', () => {
  const recorded = { text: '', sha256: 'a'.repeat(64), mediaType: 'text/plain' };
  const presentation = {
    presentationId: '12345678-1234-4123-8123-123456789ac1',
    format: 'browser-bundle-v1',
    stepSignature: 'steps',
    labels: ['Start'],
    seed: 1,
    source: recorded,
    html: recorded,
    javascript: recorded
  };

  it('rejects a JavaScript bundle claiming the script-free HTML mode', () => {
    expect(
      v.safeParse(browserBundlePresentationSchema, { ...presentation, mode: 'html' }).success
    ).toBe(false);
    expect(
      v.safeParse(browserBundlePresentationSchema, { ...presentation, mode: 'sverlin' }).success
    ).toBe(true);
    expect(
      v.safeParse(browserBundlePresentationSchema, { ...presentation, mode: 'html-js' }).success
    ).toBe(true);
  });

  it('reads steps stored with several names by their innermost, the last', () => {
    const stored = {
      ...presentation,
      mode: 'sverlin',
      steps: [['start'], ['@a#1', '@a.b#1'], 'end']
    };
    expect(v.parse(browserBundlePresentationSchema, stored).steps).toEqual([
      'start',
      '@a.b#1',
      'end'
    ]);
  });
});
