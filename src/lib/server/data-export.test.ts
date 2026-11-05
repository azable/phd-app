import { describe, expect, it, vi } from 'vitest';

import {
  writeDataExport,
  type ExportDataSource,
  type ExportSink,
  type ExportSnapshot
} from './data-export';

describe('project data export traversal', () => {
  it('writes one canonical project and interaction tree without authentication data', async () => {
    const snapshot = fixtureSnapshot();
    const files = new Map<string, Uint8Array>();
    const sink: ExportSink = {
      write(pathname, value) {
        files.set(pathname, Uint8Array.from(value));
      }
    };
    const source: ExportDataSource = {
      collect: vi.fn(async () => snapshot),
      collectInteractions: vi.fn(async () => ({
        sessions: [
          {
            id: '12345678-1234-4123-8123-123456789abc',
            projectId: 'project-test',
            studyRunId: 'run-1',
            studyPhaseId: 'task-one',
            schemaVersion: 1,
            clientStartedAt: '2026-08-30T10:00:00.000Z',
            clientTimeOrigin: 1,
            initialViewport: { width: 1280, height: 720, devicePixelRatio: 1 },
            applicationVersion: '0.0.1',
            capture: {},
            acceptedThrough: 1,
            clientStoppedAt: '2026-08-30T10:01:00.000Z',
            recordedThrough: 1,
            deliveryCompletedAt: '2026-08-30T10:01:01.000Z',
            createdAt: '2026-08-30T10:00:00.000Z',
            updatedAt: '2026-08-30T10:01:00.000Z'
          }
        ],
        events: [
          {
            sessionId: '12345678-1234-4123-8123-123456789abc',
            sequence: 1,
            kind: 'draft.snapshot',
            elapsedMs: 1_000,
            clientOccurredAt: '2026-08-30T10:00:01.000Z',
            projectHead: 4,
            payload: {
              content: [{ type: 'markdown', text: 'unsent research draft' }],
              focused: true,
              truncated: false,
              originalByteLength: 47
            },
            receivedAt: '2026-08-30T10:00:02.000Z'
          }
        ],
        expectedProjects: [
          {
            projectId: 'project-test',
            studyRunId: 'run-1',
            studyPhaseId: 'task-one',
            captureStartedAt: '2026-08-30T10:00:00.000Z',
            captureEndedAt: '2026-08-30T11:00:00.000Z',
            deliveryEndsAt: '2026-08-31T11:00:00.000Z'
          }
        ]
      }))
    };

    const manifest = await writeDataExport(
      source,
      sink,
      { type: 'projects', projectId: 'project-test' },
      '2026-08-30T12:00:00.000Z'
    );

    expect([...files.keys()]).toEqual([
      'owners.json',
      'participants.json',
      'study/definitions.json',
      'study/enrollments.json',
      'study/runs.json',
      'study/phases.json',
      'study/flows.json',
      'projects/project-test/project.json',
      'interactions/sessions.json',
      'interactions/events.jsonl',
      'sensitive/unsent-feedback-drafts.jsonl',
      'interactions/coverage.json',
      'manifest.json'
    ]);
    expect(manifest).toMatchObject({
      scope: { type: 'projects', projectId: 'project-test' },
      ownerCount: 1,
      projectCount: 1
    });
    expect(manifest.files).toHaveLength(12);
    expect(manifest.interactions).toMatchObject({
      status: 'included',
      sessionCount: 1,
      eventCount: 1,
      draftSnapshotCount: 1,
      completeSessionCount: 1,
      openSessionCount: 0,
      pendingSessionCount: 0,
      incompleteSessionCount: 0,
      missingProjectCount: 0
    });
    expect(JSON.parse(Buffer.from(files.get('owners.json')!).toString())).toEqual([
      { id: 'owner-1', label: 'P001', role: 'user', enabled: true }
    ]);
    expect(Buffer.from(files.get('owners.json')!).toString()).not.toContain('@');
    const exportedFile = JSON.parse(
      Buffer.from(files.get('projects/project-test/project.json')!).toString()
    );
    // A project with no model calls still says what they cost: nothing.
    expect(exportedFile.aiCosts).toMatchObject({
      total: { calls: 0, costUsd: 0, priced: true },
      operations: [],
      calls: []
    });
    const exportedProject = exportedFile.document;
    expect(exportedProject.events[1].payload.intakeStep).toBe('algorithm');
    expect(exportedProject.events[2].payload).toEqual({
      interactionEventId: 7,
      outcome: 'answered'
    });
    expect(exportedProject.events[3].payload).toMatchObject({
      preferred: '12345678-1234-4123-8123-123456789ac1',
      step: 0
    });
    expect(source.collect).toHaveBeenCalledWith({
      type: 'projects',
      projectId: 'project-test'
    });
    const publicInteractions = Buffer.from(files.get('interactions/events.jsonl')!).toString();
    expect(publicInteractions).not.toContain('unsent research draft');
    expect(publicInteractions).toContain('sensitiveDraftRecordId');
    expect(Buffer.from(files.get('sensitive/unsent-feedback-drafts.jsonl')!).toString()).toContain(
      'unsent research draft'
    );
    expect(
      JSON.parse(Buffer.from(files.get('interactions/coverage.json')!).toString())
    ).toMatchObject({
      sessions: [
        {
          sessionId: '12345678-1234-4123-8123-123456789abc',
          status: 'complete'
        }
      ],
      projects: [{ projectId: 'project-test', status: 'recorded' }]
    });
  });

  it('keeps the primary export usable when interaction collection fails', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.projects = [];
    const files = new Map<string, Uint8Array>();
    const source: ExportDataSource = {
      collect: vi.fn(async () => snapshot),
      collectInteractions: vi.fn(async () => {
        throw new Error('telemetry database unavailable');
      })
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const manifest = await writeDataExport(
      source,
      { write: (pathname, value) => void files.set(pathname, Uint8Array.from(value)) },
      { type: 'projects' },
      '2026-08-30T12:00:00.000Z'
    );

    expect(manifest.interactions.status).toBe('unavailable');
    expect(files.has('owners.json')).toBe(true);
    expect(files.has('interactions/coverage.json')).toBe(true);
    expect(files.has('interactions/events.jsonl')).toBe(false);
    warning.mockRestore();
  });

  it('reports incomplete sessions, dropped observations, and started projects with no session', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.projects = [];
    const files = new Map<string, Uint8Array>();
    const source: ExportDataSource = {
      collect: vi.fn(async () => snapshot),
      collectInteractions: vi.fn(async () => ({
        sessions: [
          {
            id: '12345678-1234-4123-8123-123456789abc',
            projectId: 'project-observed',
            schemaVersion: 1,
            clientStartedAt: '2026-08-30T10:00:00.000Z',
            clientTimeOrigin: 1,
            initialViewport: { width: 1280, height: 720, devicePixelRatio: 1 },
            applicationVersion: '0.0.1',
            capture: {},
            acceptedThrough: 1,
            createdAt: '2026-08-30T10:00:00.000Z',
            updatedAt: '2026-08-30T10:01:00.000Z'
          }
        ],
        events: [
          {
            sessionId: '12345678-1234-4123-8123-123456789abc',
            sequence: 1,
            kind: 'recorder.dropped',
            elapsedMs: 1,
            clientOccurredAt: '2026-08-30T10:00:00.001Z',
            projectHead: 1,
            payload: { reason: 'outbox-limit', counts: { 'pointer.path': 2 } },
            receivedAt: '2026-08-30T10:00:01.000Z'
          }
        ],
        expectedProjects: ['project-observed', 'project-missing'].map((projectId, index) => ({
          projectId,
          studyRunId: 'run-one',
          studyPhaseId: `task-${index + 1}`,
          captureStartedAt: '2026-08-30T10:00:00.000Z',
          captureEndedAt: '2026-08-30T11:00:00.000Z',
          deliveryEndsAt: '2026-08-31T11:00:00.000Z'
        }))
      }))
    };

    const manifest = await writeDataExport(
      source,
      { write: (pathname, value) => void files.set(pathname, Uint8Array.from(value)) },
      { type: 'projects' },
      '2026-09-01T12:00:00.000Z'
    );

    expect(manifest.interactions).toMatchObject({
      incompleteSessionCount: 1,
      missingProjectCount: 1,
      droppedEventCount: 2
    });
    expect(manifest.interactions.warnings).toHaveLength(2);
    expect(
      JSON.parse(Buffer.from(files.get('interactions/coverage.json')!).toString())
    ).toMatchObject({
      sessions: [{ status: 'incomplete' }],
      projects: [
        { projectId: 'project-observed', status: 'recorded' },
        { projectId: 'project-missing', status: 'missing' }
      ],
      droppedByReason: { 'outbox-limit': 2 }
    });
  });

  it('warns of a phase whose first session reached the server long after the phase began', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.projects = [];
    const files = new Map<string, Uint8Array>();
    const session = (id: string, projectId: string, createdAt: string) => ({
      id,
      projectId,
      schemaVersion: 1,
      clientStartedAt: createdAt,
      clientTimeOrigin: 1,
      initialViewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      applicationVersion: '0.0.1',
      capture: {},
      acceptedThrough: 1,
      recordedThrough: 1,
      createdAt,
      updatedAt: createdAt
    });
    const source: ExportDataSource = {
      collect: vi.fn(async () => snapshot),
      collectInteractions: vi.fn(async () => ({
        // As in the pilot: the first task heard from 7 s in, the second only after a reload, 184 s in.
        sessions: [
          session(
            '12345678-1234-4123-8123-123456789abc',
            'project-one',
            '2026-08-30T10:00:07.000Z'
          ),
          session('22345678-1234-4123-8123-123456789abc', 'project-two', '2026-08-30T10:18:04.000Z')
        ],
        events: [],
        expectedProjects: [
          { projectId: 'project-one', captureStartedAt: '2026-08-30T10:00:00.000Z' },
          { projectId: 'project-two', captureStartedAt: '2026-08-30T10:15:00.000Z' }
        ].map((project, index) => ({
          ...project,
          studyRunId: 'run-one',
          studyPhaseId: `task-${index + 1}`,
          captureEndedAt: '2026-08-30T11:00:00.000Z',
          deliveryEndsAt: '2026-08-31T11:00:00.000Z'
        }))
      }))
    };

    const manifest = await writeDataExport(
      source,
      { write: (pathname, value) => void files.set(pathname, Uint8Array.from(value)) },
      { type: 'projects' },
      '2026-09-01T12:00:00.000Z'
    );

    expect(manifest.interactions.warnings).toEqual([
      expect.stringContaining('task-2 (project-two) has no interaction records for its first 184 s')
    ]);
    const coverage = JSON.parse(Buffer.from(files.get('interactions/coverage.json')!).toString());
    expect(coverage.projects[0]).not.toHaveProperty('unrecordedSeconds');
    expect(coverage.projects[1]).toMatchObject({ unrecordedSeconds: 184 });
  });
});

function fixtureSnapshot(): ExportSnapshot {
  return {
    owners: [{ id: 'owner-1', label: 'P001', role: 'user', enabled: true }],
    projects: [
      {
        id: 'project-test',
        ownerUserId: 'owner-1',
        title: 'Project export fixture',
        templateId: 'blank',
        mode: 'sverlin',
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T11:00:00.000Z',
        document: {
          schemaVersion: 1,
          projectId: 'project-test',
          events: [
            {
              id: 1,
              type: 'project.created',
              actor: { kind: 'user' },
              operationId: '12345678-1234-4123-8123-123456789abc',
              createdAt: '2026-08-30T10:00:00.000Z',
              payload: {
                title: 'Project export fixture',
                entryArtifactId: 'main',
                assistantId: 'sverlin-assistant',
                creation: { templateId: 'blank' }
              }
            },
            {
              id: 2,
              type: 'assistant.responded',
              actor: { kind: 'assistant', botId: 'sverlin-assistant' },
              operationId: '12345678-1234-4123-8123-123456789abd',
              createdAt: '2026-08-30T10:01:00.000Z',
              payload: {
                content: [{ type: 'markdown', text: 'What algorithm?' }],
                intakeStep: 'algorithm'
              }
            },
            {
              id: 3,
              type: 'assistant.intake-completed',
              actor: { kind: 'system' },
              operationId: '12345678-1234-4123-8123-123456789abe',
              createdAt: '2026-08-30T10:04:00.000Z',
              payload: { interactionEventId: 7, outcome: 'answered' }
            },
            {
              id: 4,
              type: 'visualization.preference-recorded',
              actor: { kind: 'user' },
              operationId: '12345678-1234-4123-8123-123456789abd',
              createdAt: '2026-08-30T10:05:00.000Z',
              payload: {
                presentations: [
                  '12345678-1234-4123-8123-123456789ac1',
                  '12345678-1234-4123-8123-123456789ac2'
                ],
                preferred: '12345678-1234-4123-8123-123456789ac1',
                step: 0
              }
            }
          ]
        }
      }
    ],
    participants: [],
    study: { definitions: [], enrollments: [], runs: [], phases: [], flows: [] }
  };
}
