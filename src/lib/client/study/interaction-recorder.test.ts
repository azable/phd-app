import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainStudy } from '$lib/studies/main';

import { ResilientInteractionOutbox, type InteractionOutbox } from './interaction-outbox';
import { interactionName, ProjectInteractionRecorder } from './interaction-recorder';

describe('interaction names', () => {
  const element = (attributes: Record<string, string>, dataset: Record<string, string> = {}) =>
    ({
      dataset,
      tagName: 'BUTTON',
      textContent: 'participant text',
      getAttribute: (name: string) => attributes[name] ?? null
    }) as unknown as HTMLElement;

  it('names an element by its title before its role or tag, never its text', () => {
    expect(interactionName(element({ title: 'Interface help', role: 'button' }))).toBe(
      'Interface help'
    );
    expect(interactionName(element({ role: 'button' }))).toBe('button');
    expect(interactionName(element({ title: 'Help' }, { interaction: 'tour-help' }))).toBe(
      'tour-help'
    );
    expect(interactionName(element({}))).toBe('button');
  });
});

describe('project interaction recorder isolation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not surface outbox or transport failures to workspace calls', async () => {
    vi.useFakeTimers();
    const browserDocument = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      hasFocus: () => true
    });
    const browserWindow = new EventTarget();
    vi.stubGlobal('document', browserDocument);
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.stubGlobal('devicePixelRatio', 1);
    const failure = async () => {
      throw new Error('telemetry unavailable');
    };
    const outbox: InteractionOutbox = {
      putSession: vi.fn(failure),
      finalize: vi.fn(failure),
      block: vi.fn(failure),
      putEvent: vi.fn(failure),
      replaceEvent: vi.fn(failure),
      sessions: vi.fn(failure),
      events: vi.fn(failure),
      acknowledge: vi.fn(failure),
      complete: vi.fn(failure),
      abandon: vi.fn(failure)
    };
    const recorder = new ProjectInteractionRecorder({
      projectId: 'project-one',
      participantId: 'participant-one',
      capture: mainStudy.interactionCapture!,
      applicationVersion: 'test',
      outbox,
      fetch: vi.fn(async () => {
        throw new Error('offline');
      })
    });
    const root = new EventTarget() as HTMLElement;

    expect(() => {
      recorder.start(root);
      recorder.recordWorkspaceState({
        projectHead: 1,
        connection: 'open',
        atHead: true,
        layout: 'single',
        visiblePresentationIds: [],
        followingLatestPresentations: true,
        focusedTimelineEvents: [],
        viewports: [],
        draft: { hasContent: false, characterCount: 0, referenceCount: 0, focused: false },
        document: {
          visibility: 'visible',
          focused: true,
          viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
        }
      });
      recorder.recordDraft([{ type: 'markdown', text: 'draft' }], true);
      vi.advanceTimersByTime(1);
      recorder.stop();
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(outbox.putSession).toHaveBeenCalled();
  });

  it('does not record observations after the independent capture deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'));
    installBrowserGlobals();
    const putEvent = vi.fn<InteractionOutbox['putEvent']>(async () => ({
      stored: true,
      dropped: {},
      storageUnavailable: false
    }));
    const outbox: InteractionOutbox = {
      putSession: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
      block: vi.fn(async () => undefined),
      putEvent,
      replaceEvent: vi.fn(async () => undefined),
      sessions: vi.fn(async () => []),
      events: vi.fn(async () => []),
      acknowledge: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      abandon: vi.fn(async () => undefined)
    };
    const recorder = new ProjectInteractionRecorder({
      projectId: 'project-one',
      participantId: 'participant-one',
      capture: mainStudy.interactionCapture!,
      captureEndsAt: '2026-08-30T10:00:01.000Z',
      applicationVersion: 'test',
      outbox,
      fetch: vi.fn(async () => new Response(null, { status: 503 }))
    });
    recorder.start(new EventTarget() as HTMLElement);
    recorder.recordWorkspaceState(workspaceObservation());
    await recorder.flush();

    vi.advanceTimersByTime(1_001);
    recorder.recordWorkspaceState({ ...workspaceObservation(), projectHead: 2 });
    recorder.recordDraft([{ type: 'markdown', text: 'too late' }], true);
    await recorder.flush();

    expect(putEvent).toHaveBeenCalledTimes(1);
    expect(putEvent.mock.calls[0]?.[0].event.kind).toBe('workspace.state');
  });

  it('keeps simultaneous tabs as separate active sessions', async () => {
    installBrowserGlobals();
    const outbox = new ResilientInteractionOutbox();
    const options = {
      projectId: 'project-one',
      participantId: 'participant-one',
      capture: mainStudy.interactionCapture!,
      applicationVersion: 'test',
      outbox,
      fetch: vi.fn(async () => new Response(null, { status: 503 }))
    };
    const first = new ProjectInteractionRecorder(options);
    const second = new ProjectInteractionRecorder(options);

    first.start(new EventTarget() as HTMLElement);
    second.start(new EventTarget() as HTMLElement);
    first.recordWorkspaceState(workspaceObservation());
    second.recordWorkspaceState(workspaceObservation());
    await first.flush();
    await second.flush();

    const sessions = await outbox.sessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.every(({ terminal }) => terminal === undefined)).toBe(true);
    first.dispose();
    second.dispose();
  });
});

function installBrowserGlobals(): void {
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true })
  );
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  vi.stubGlobal('devicePixelRatio', 1);
}

function workspaceObservation() {
  return {
    projectHead: 1,
    connection: 'open' as const,
    atHead: true,
    layout: 'single' as const,
    visiblePresentationIds: [],
    followingLatestPresentations: true,
    focusedTimelineEvents: [],
    viewports: [],
    draft: { hasContent: false, characterCount: 0, referenceCount: 0, focused: false },
    document: {
      visibility: 'visible' as const,
      focused: true,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
    }
  };
}
