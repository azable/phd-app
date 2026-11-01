import { describe, expect, it } from 'vitest';

import { readingText } from './scene';

describe('readingText', () => {
  it('joins pieces split by a block as they read', () => {
    expect(readingText(['A[', 'i', ']'])).toBe('A[i]');
  });

  it('parts the pieces around one left out', () => {
    expect(readingText(['found', undefined, 'here'])).toBe('found here');
  });

  it('collapses and trims whitespace', () => {
    expect(readingText(['  Step ', '3', '\n'])).toBe('Step 3');
  });
});
