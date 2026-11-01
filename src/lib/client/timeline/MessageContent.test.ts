import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import MessageContent from './MessageContent.svelte';

describe('message content', () => {
  it('draws an interface part the reply points at as a pill with its name', () => {
    const { body } = render(MessageContent, {
      props: {
        content: [
          { type: 'markdown', text: 'Use the' },
          { type: 'interface-ref', part: 'answer-buttons' },
          { type: 'markdown', text: '. Choose again to change it.' }
        ]
      }
    });
    expect(body).toMatch(/<button[^>]*class="interface-ref[^>]*>Answer buttons<\/button>/u);
    expect(body).toContain('title="Show the Answer buttons"');
    // The full stop after it stays on its line.
    expect(body).toMatch(
      /Answer buttons<\/button>(?:<!--[^>]*-->)*<span class="ref-punctuation[^"]*">\.<\/span>/u
    );
  });

  it('draws it without a button where the message is not interactive', () => {
    const { body } = render(MessageContent, {
      props: { content: [{ type: 'interface-ref', part: 'step-controls' }], interactive: false }
    });
    expect(body).not.toContain('<button');
    expect(body).toContain('Step controls');
  });
});
