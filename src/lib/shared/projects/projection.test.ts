import { describe, expect, it } from 'vitest';

import {
  InvalidProjectDocumentError,
  normalizeProjectEvent,
  type ProjectEvent,
  type ProjectEventOf
} from './events';
import { normalizeProject, parseProjectCommand, type ProjectDocument } from './model';
import { headStillCurrent, projectSnapshotAt, summarizeProject } from './projection';

const operationId = '12345678-1234-4123-8123-123456789abc';
const displaySetId = '22345678-1234-4234-8234-123456789abc';
const presentationId = '32345678-1234-4234-8234-123456789abc';
const hash = '0'.repeat(64);
const recorded = { text: '{}', sha256: hash, mediaType: 'application/json' };

describe('project model and projection', () => {
  it('accepts only version-one documents with stable 1-based event IDs', () => {
    const document = documentWithHistory();
    expect(normalizeProject(document)).toEqual(document);
    expect(() => normalizeProject({ ...document, schemaVersion: 0 })).toThrow(
      InvalidProjectDocumentError
    );
    expect(() =>
      normalizeProject({
        ...document,
        events: document.events.map((event, index) => (index === 2 ? { ...event, id: 4 } : event))
      })
    ).toThrow(InvalidProjectDocumentError);
  });

  it('validates structured presentation references', () => {
    expect(() =>
      normalizeProjectEvent({ ...documentWithHistory().events[0], operationId: 'not-a-uuid' })
    ).toThrow(InvalidProjectDocumentError);

    expect(
      parseProjectCommand({
        type: 'feedback',
        operationId,
        expectedHead: 5,
        content: [
          { type: 'markdown', text: 'Prefer this presentation' },
          { type: 'presentation-ref', presentationId }
        ],
        focus: [2],
        presentationCount: 1
      })
    ).toMatchObject({ type: 'feedback', focus: [2] });
  });

  it('validates build source and positive presentation seeds', () => {
    const request = {
      id: 2,
      operationId,
      actor: { kind: 'system' },
      createdAt: '2026-01-01T00:00:02.000Z',
      type: 'build.requested',
      payload: {
        purpose: 'manual-edit',
        input: 'committed-artifact',
        source: recorded,
        sourceLabel: 'Main.svelte',
        seed: 1
      }
    };
    expect(normalizeProjectEvent(request)).toEqual(request);
    expect(() =>
      normalizeProjectEvent({
        ...request,
        payload: {
          ...request.payload,
          seed: 0
        }
      })
    ).toThrow(InvalidProjectDocumentError);
  });

  it('replays historical source and clears stale presentations after an artifact edit', () => {
    const document = documentWithHistory();
    expect(projectSnapshotAt(document, 3).activePresentationSet?.presentations[0].id).toBe(3);
    expect(projectSnapshotAt(document, 4).activePresentationSet).toBeUndefined();
    expect(projectSnapshotAt(document, 2).artifacts.main?.content.sha256).toBe(hash);
    expect(projectSnapshotAt(document).activePresentationSet?.presentations[0]).toMatchObject({
      id: 5,
      payload: { presentation: { source: { sha256: '1'.repeat(64) } } }
    });
    expect(summarizeProject(document).templateId).toBe('blank');
  });

  it('ignores message-only events when reconstructing state', () => {
    const document = documentWithHistory();
    const withResponse: ProjectDocument = {
      ...document,
      events: [
        ...document.events,
        event(6, 'assistant.responded', {
          content: [{ type: 'markdown', text: 'Done' }]
        })
      ]
    };
    expect(projectSnapshotAt(withResponse)).toEqual({ ...projectSnapshotAt(document), at: 6 });
  });

  it('keeps an expected head current past load reports, and only past them', () => {
    const read: Pick<ProjectEvent, 'type'>[] = [
      { type: 'project.created' },
      { type: 'visualization.presented' }
    ];
    const loaded = [...read, { type: 'visualization.loaded' as const }];
    expect(headStillCurrent(read, 2)).toBe(true);
    expect(headStillCurrent(loaded, 2)).toBe(true);
    expect(headStillCurrent([...loaded, { type: 'project.renamed' }], 2)).toBe(false);
    // A head the Timeline has not reached is never current.
    expect(headStillCurrent(read, 3)).toBe(false);
  });
});

function documentWithHistory(): ProjectDocument {
  const edited = { ...recorded, text: 'edited', sha256: '1'.repeat(64) };
  return {
    schemaVersion: 1,
    projectId: 'project-test',
    events: [
      event(1, 'project.created', {
        title: 'Test',
        entryArtifactId: 'main',
        assistantId: 'sverlin-assistant',
        creation: { templateId: 'blank' }
      }),
      event(2, 'artifact.version-created', {
        origin: { kind: 'initial' },
        changes: [
          {
            operation: 'upsert',
            artifact: {
              artifactId: 'main',
              path: 'Main.svelte',
              language: 'svelte',
              content: { ...recorded, text: 'initial', mediaType: 'text/x-svelte' }
            }
          }
        ]
      }),
      presented(3, recorded, '42345678-1234-4234-8234-123456789abc'),
      event(4, 'artifact.version-created', {
        origin: { kind: 'manual-edit' },
        changes: [
          {
            operation: 'upsert',
            artifact: {
              artifactId: 'main',
              path: 'Main.svelte',
              language: 'svelte',
              content: { ...edited, mediaType: 'text/x-svelte' }
            }
          }
        ]
      }),
      presented(5, edited, presentationId)
    ]
  };
}

function presented(
  id: number,
  source: typeof recorded,
  idValue: string
): ProjectEventOf<'visualization.presented'> {
  return event(id, 'visualization.presented', {
    displaySetId,
    slot: 0,
    presentation: {
      presentationId: idValue,
      format: 'browser-bundle-v1',
      mode: 'sverlin',
      stepSignature: 'one-step',
      labels: ['Only step'],
      seed: id,
      source,
      html: recorded,
      javascript: recorded
    }
  });
}

function event<Type extends ProjectEvent['type']>(
  id: number,
  type: Type,
  payload: ProjectEventOf<Type>['payload']
): ProjectEventOf<Type> {
  return {
    id,
    type,
    operationId,
    actor: { kind: 'system' },
    createdAt: `2026-01-01T00:00:${String(id).padStart(2, '0')}.000Z`,
    payload
  } as ProjectEventOf<Type>;
}
