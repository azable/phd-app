import { describe, expect, it } from 'vitest';

import { withoutHeader } from './dev-demo-header';

describe('a demo example header', () => {
  it('reads each line, a note among them, and leaves the source', () => {
    const example = [
      '<!-- summary: Marks with `@left`. -->',
      '<!-- variant: {"frames":"compare"} -->',
      '<!-- note: Click `@left` to see where it is labelled. -->',
      '<script lang="sverlin"></script>'
    ].join('\n');
    expect(withoutHeader(example)).toEqual({
      source: '<script lang="sverlin"></script>',
      summary: 'Marks with `@left`.',
      variant: '{"frames":"compare"}',
      note: 'Click `@left` to see where it is labelled.'
    });
  });

  it('reads no header from a source without one', () => {
    expect(withoutHeader('<script lang="sverlin"></script>')).toEqual({
      source: '<script lang="sverlin"></script>'
    });
  });
});
