import { describe, expect, it } from 'vitest';

import { compileHtmlJs } from './compile.server';

describe('HTML/JS packaging', () => {
  it('sanitizes active markup and keeps separately authored script', async () => {
    const result = await compileHtmlJs({
      format: 'html-js-v1',
      html: '<h1 onclick="alert(1)">Hello</h1><script>evil()</script>',
      javascript: 'document.querySelector("h1").textContent = "Ready";'
    });
    expect(result.html).toBe('<h1>Hello</h1>');
    expect(result.javascript).toContain('Ready');
  });

  it('declares one playback step per label, numbering repeats, and keeps static SVG', async () => {
    const result = await compileHtmlJs({
      format: 'html-js-v1',
      steps: ['Start', 'Visit A', 'Visit A', 'Done'],
      html: '<svg viewBox="0 0 10 10" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><line x1="0" y1="0" x2="5" y2="5" stroke="black"/><text x="1" y="9">A</text></svg>',
      javascript: 'const step = window.__sverlinStep;'
    });
    expect(result.steps).toEqual(['Start', 'Visit A', 'Visit A (2)', 'Done']);
    expect(result.html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(result.html).toContain('<line x1="0" y1="0" x2="5" y2="5" stroke="black"></line>');
    expect(result.html).toContain('<text x="1" y="9">A</text>');
    // A source without steps, as the starter, has the one step "Start".
    const earlier = await compileHtmlJs({ format: 'html-js-v1', html: '<p>A</p>', javascript: '' });
    expect(earlier.steps).toEqual(['Start']);
    await expect(
      compileHtmlJs({ format: 'html-js-v1', steps: [], html: '<p>A</p>', javascript: '' })
    ).rejects.toThrow('The HTML/JS source is not valid');
  });

  it('rejects static and dynamic imports, including computed targets', async () => {
    for (const javascript of [
      'import x from "x";',
      'import("x")',
      'import(window.target)',
      'export const x = 1'
    ]) {
      await expect(
        compileHtmlJs({ format: 'html-js-v1', html: '<h1>Safe</h1>', javascript })
      ).rejects.toThrow('cannot import or export');
    }
  });
});
