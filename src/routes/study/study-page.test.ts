import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import StudyPage from './+page.svelte';
import { actions } from './+page.server';

const study = vi.hoisted(() => ({ continueParticipantStudy: vi.fn() }));
vi.mock('$lib/server/study', () => study);

const completionState = {
  studyId: 'main-study',
  studyVersion: 1,
  armId: 'sverlin-first',
  phaseIndex: 4,
  phase: {
    id: 'complete',
    kind: 'completion' as const,
    title: 'Study complete',
    paragraphs: ['Thank you. Your responses have been recorded.']
  },
  expired: false
};

describe('completed study page', () => {
  it('shows the participant gift-card link and logout action', () => {
    const { body } = render(StudyPage, {
      props: {
        data: {
          state: completionState,
          giftCardUrl: 'https://gift.example/card/static'
        },
        form: null
      } as never
    });

    expect(body).toContain('Open your gift card');
    expect(body).toContain('https://gift.example/card/static');
    expect(body).toContain('referrerpolicy="no-referrer"');
    expect(body).toContain('action="/logout"');
    expect(body).toContain('Sign out');
  });

  it('shows contact guidance without hiding logout when no card is assigned', () => {
    const { body } = render(StudyPage, {
      props: { data: { state: completionState }, form: null } as never
    });

    expect(body).toContain('No gift card has been assigned. Please contact the researcher.');
    expect(body).toContain('action="/logout"');
  });
});

describe('study progression actions', () => {
  it('uses named actions consistently once early completion is available', () => {
    expect(actions).toHaveProperty('continue');
    expect(actions).toHaveProperty('early');
    expect(actions).not.toHaveProperty('default');
  });

  it('posts ordinary progression to the named continue action', () => {
    const { body } = render(StudyPage, {
      props: {
        data: {
          state: {
            ...completionState,
            phaseIndex: 0,
            phase: {
              id: 'welcome',
              kind: 'instruction' as const,
              title: 'Welcome',
              paragraphs: ['Welcome to the study.'],
              continueLabel: 'Start'
            }
          }
        },
        form: null
      } as never
    });

    expect(body).toContain('action="/study?/continue"');
    expect(body).toContain('name="phaseId" value="welcome"');
  });

  it('continues only from the phase posted, then redirects so a reload sends nothing', async () => {
    study.continueParticipantStudy.mockResolvedValue({
      ...completionState,
      phase: { id: 'between-tasks', kind: 'instruction' }
    });
    const body = new FormData();
    body.set('phaseId', 'task-one');
    const event = {
      locals: { principal: { kind: 'participant', user: { id: 'participant' } } },
      request: new Request('http://localhost/study?/continue', { method: 'POST', body })
    };

    await expect(actions.continue(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/study'
    });
    expect(study.continueParticipantStudy).toHaveBeenCalledWith('participant', {
      phaseId: 'task-one'
    });
  });
});
