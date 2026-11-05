import { describe, expect, it } from 'vitest';

import bars from './fixtures/bars.sverlin?raw';
import bot from './bot.server';
import {
  checkCandidate,
  fullGuidePrompt,
  guideSections,
  mainViewType,
  viewHelperPrompt
} from './view-helpers.server';

describe('view helpers', () => {
  it('take the guide by heading, each section up to the next heading', () => {
    const markdown = '## A\na\n### B\nb\n## C\nc';
    expect(guideSections(markdown, ['## A', '## C'])).toBe('## A\na\n\n## C\nc');
    expect(viewHelperPrompt.length).toBeLessThan(fullGuidePrompt.length / 2);
  });

  it('propose views of the type the source draws as values, not its pointers', () => {
    expect(mainViewType(bars)).toBe('Int');
  });

  it('keep a view that builds and reads, and leave out one that does not', async () => {
    const kept = await checkCandidate(bars, 'Int', {
      name: 'IntCell',
      description: 'the number in a cell',
      markup: '<View of="Int" name="IntCell"><Node value={this} /></View>'
    });
    expect(kept).toMatchObject({ kept: true, name: 'IntCell', type: 'Int' });

    const broken = await checkCandidate(bars, 'Int', {
      name: 'IntBroken',
      description: 'reads a name nothing gives it',
      markup: '<View of="Int" name="IntBroken"><Node value={missing} /></View>'
    });
    expect(broken).toMatchObject({ kept: false, name: 'IntBroken' });

    const other = await checkCandidate(bars, 'Int', {
      name: 'Elsewhere',
      description: 'a view of another type',
      markup: '<View of="Position" name="Elsewhere"><Pointed /></View>'
    });
    expect(other).toMatchObject({ kept: false });
  });

  it('leave the reply as it was where the helpers are off', () => {
    const request = { project: {}, messages: [], attempt: 1 } as never;
    expect(bot.responseFormatFor?.(request)).toBe(bot.responseFormat);
    const on = bot.responseFormatFor?.({
      ...(request as object),
      project: { viewHelpers: {} }
    } as never);
    expect(on?.schema).toHaveProperty('properties.viewHelpers');
  });
});
