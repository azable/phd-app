import { describe, expect, it } from 'vitest';

import { renderSafeInlineMarkdown, renderSafeMarkdown } from './markdown';

describe('retained message Markdown', () => {
  it('renders ordinary Markdown without enabling raw HTML', () => {
    const rendered = renderSafeMarkdown(
      '**Clear**\n\n- one\n- two\n\n<img src=x onerror=alert(1)>'
    );

    expect(rendered).toContain('<strong>Clear</strong>');
    expect(rendered).toContain('<li>one</li>');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('onerror');
  });

  it('keeps safe links and removes executable URL schemes', () => {
    const rendered = renderSafeMarkdown(
      '[safe](https://example.com) [unsafe](javascript:alert(1))'
    );

    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).toContain('rel="nofollow noreferrer"');
    expect(rendered).not.toContain('href="javascript:');
  });
});

describe('inline Markdown', () => {
  it('renders emphasis and code without blocks, links or raw HTML', () => {
    const rendered = renderSafeInlineMarkdown(
      'Should it carry **the** `i` [label](https://example.com)? <img src=x onerror=alert(1)>'
    );

    expect(rendered).toBe('Should it carry <strong>the</strong> <code>i</code> label? ');
  });
});
