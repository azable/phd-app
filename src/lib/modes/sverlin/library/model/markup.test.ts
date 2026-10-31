import { describe, expect, it } from 'vitest';

import { readMarkup } from './markup';
import type { ModelElement } from './tree';

const only = (markup: string) => readMarkup(markup).children[0] as ModelElement;

describe('readMarkup', () => {
  it('reads elements, their attributes and inline declarations, and text, without comments', () => {
    const root = readMarkup(
      '<!--[--><div class="a b" data-sv-node="3:5" hidden style="padding: 0.5em; color: oklch(0.6 0.2 277);">x &amp; y<!----><span>&lt;1&gt; &#39;2&#39;</span></div><!--]-->',
      { tag: 'div', attributes: { class: 'layer' } }
    );
    expect(root.attributes).toEqual({ class: 'layer' });
    expect(root.children).toEqual([
      {
        tag: 'div',
        attributes: { class: 'a b', 'data-sv-node': '3:5', hidden: '' },
        style: { padding: '0.5em', color: 'oklch(0.6 0.2 277)' },
        children: ['x & y', { tag: 'span', attributes: {}, style: {}, children: ["<1> '2'"] }]
      }
    ]);
  });

  it('opens no element for void and self-closing tags, and closes those left open', () => {
    const div = only('<div><br><path d="M0 0" /><p>a<b>b</p>c</div>');
    expect(div.children.map((child) => (typeof child === 'string' ? child : child.tag))).toEqual([
      'br',
      'path',
      'p',
      'c'
    ]);
  });

  it('reads a declaration holding a semicolon in quotes whole', () => {
    expect(only(`<div style="font-family: 'a;b', serif; width: 2px"></div>`).style).toEqual({
      'font-family': "'a;b', serif",
      width: '2px'
    });
  });
});
