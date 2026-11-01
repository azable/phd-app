/** Pure presentation-buffer projections over the immutable project Timeline. */

import type { ProjectEvent } from './events';
import type { ProjectDocument } from './model';
import { projectSnapshotAt } from './projection';
import { isSverlinPresentation, presentationScenarioKey } from '$lib/shared/presentations';

/** One current-source presentation that has not been consumed by an explicit advance action. */
export type AvailablePresentation = {
  eventId: number;
  presentationId: string;
  scenarioKey: string;
  operationId: string;
  displaySetId?: string;
};

/** Current state of a configured ahead-of-time presentation buffer. */
export type PresentationBufferState = {
  sourceSha256?: string;
  hasCurrentSourcePresentation: boolean;
  available: AvailablePresentation[];
  consumedPresentationIds: Set<string>;
  deficit: number;
};

/** Derive current-source availability without maintaining a second mutable queue. */
export function presentationBufferState(
  value: ProjectDocument | readonly ProjectEvent[],
  target: number,
  sourceSha256?: string
): PresentationBufferState {
  const events = 'events' in value ? value.events : value;
  const currentSourceSha256 =
    sourceSha256 ?? ('events' in value ? activeSourceSha256(value) : undefined);
  const consumedPresentationIds = new Set(
    events.flatMap((event) => {
      if (event.type === 'visualization.preference-recorded') return event.payload.presentations;
      if (event.type === 'visualization.variant-reverted') return event.payload.presentations;
      return event.type === 'visualization.candidates-advanced' ? event.payload.presentations : [];
    })
  );
  const currentSourcePresentations = events.flatMap<AvailablePresentation>((event) => {
    if (event.type === 'visualization.presented') {
      const presentation = event.payload.presentation;
      if (
        (!isSverlinPresentation(presentation) &&
          !(presentation.format === 'browser-bundle-v1' && presentation.mode === 'sverlin')) ||
        presentation.source.sha256 !== currentSourceSha256
      ) {
        return [];
      }
      return [
        {
          eventId: event.id,
          presentationId: presentation.presentationId,
          scenarioKey: presentationScenarioKey(presentation),
          operationId: event.operationId,
          ...(event.payload.displaySetId ? { displaySetId: event.payload.displaySetId } : {})
        }
      ];
    }
    return [];
  });
  const available = currentSourcePresentations.filter(
    ({ presentationId }) => !consumedPresentationIds.has(presentationId)
  );
  const groupSizes = new Map<string, number>();
  for (const presentation of available) {
    groupSizes.set(presentation.scenarioKey, (groupSizes.get(presentation.scenarioKey) ?? 0) + 1);
  }
  const pairedAvailable = [...groupSizes.values()].reduce(
    (total, size) => total + Math.floor(size / 2) * 2,
    0
  );
  const deficit =
    target > 1
      ? Math.ceil(Math.max(0, target - pairedAvailable) / 2) * 2
      : Math.max(0, target - available.length);
  return {
    sourceSha256: currentSourceSha256,
    hasCurrentSourcePresentation: currentSourcePresentations.length > 0,
    available,
    consumedPresentationIds,
    deficit
  };
}

/**
 * The presentations waiting behind a shown one: those its operation presented in later display
 * sets, not yet consumed, as a vary or resample with a count queues them. New pair shows the next.
 */
export function waitingBehind(
  state: PresentationBufferState,
  presentationId: string
): AvailablePresentation[] {
  const shown = state.available.find((entry) => entry.presentationId === presentationId);
  if (!shown) return [];
  return state.available.filter(
    (entry) =>
      entry.operationId === shown.operationId &&
      entry.eventId > shown.eventId &&
      entry.displaySetId !== shown.displaySetId
  );
}

function activeSourceSha256(document: ProjectDocument): string | undefined {
  const snapshot = projectSnapshotAt(document);
  return snapshot.artifacts[snapshot.entryArtifactId]?.content.sha256;
}
