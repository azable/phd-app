import { describe, expect, it } from 'vitest';

import htmlJsAssistant from './bot.server';

describe('HTML/JS assistant contract', () => {
  it('opens with questions or a first version, as the participant chose, and knows the interface', () => {
    expect(htmlJsAssistant.initialPrompt).toContain('If they ask for questions first');
    expect(htmlJsAssistant.initialPrompt).toContain('what students should be able to do');
    expect(htmlJsAssistant.initialPrompt).toContain('interface-ref');
  });
});
