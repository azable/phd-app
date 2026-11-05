import { describe, expect, it } from 'vitest';

import bars from './fixtures/bars.sverlin?raw';
import bot, { viewHelpersRequest } from './bot.server';
import {
  checkCandidate,
  fullGuidePrompt,
  guideSections,
  mainViewType,
  viewHelperDirections,
  viewHelperPrompt,
  viewHelperTask
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

    const drawing = await checkCandidate(bars, 'Int', {
      name: 'IntDial',
      description: 'a dial whose hand turns with the number',
      markup:
        '<View of="Int" name="IntDial"><Node><Svg viewBox="0 0 24 24" height="2" label={this}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" /><line x1="12" y1="12" x2="12" y2="4" stroke="currentColor" stroke-width="2" transform={`rotate(${this * 30} 12 12)`} /></Svg></Node></View>'
    });
    expect(drawing).toMatchObject({ kept: true, name: 'IntDial' });

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

  it('take a type and a task from the reply, or a type alone from turns before tasks', () => {
    expect(viewHelpersRequest({ type: ' Card ', task: ' draw each as a playing card ' })).toEqual({
      viewHelpers: { type: 'Card', task: 'draw each as a playing card' }
    });
    expect(viewHelpersRequest({ type: 'Card', task: '' })).toEqual({
      viewHelpers: { type: 'Card' }
    });
    expect(viewHelpersRequest('Int')).toEqual({ viewHelpers: { type: 'Int' } });
    expect(viewHelpersRequest(null)).toEqual({});
    expect(viewHelpersRequest({ type: ' ', task: 'x' })).toEqual({});
  });

  it('give each helper the task and what the participant settled, with its direction', () => {
    const asked = viewHelperTask({
      type: 'Card',
      count: 1,
      source: '<View …>',
      direction: viewHelperDirections[2],
      task: 'draw each card as a playing card',
      background: 'The brief:\n- audience: first-year students'
    });
    expect(asked).toContain('of the type Card, trying a drawing');
    expect(asked).toContain('The task, from the assistant: draw each card as a playing card');
    expect(asked).toContain('- audience: first-year students');
    expect(viewHelperTask({ type: 'Int', count: 1, source: '' })).not.toContain('task');
  });
});
