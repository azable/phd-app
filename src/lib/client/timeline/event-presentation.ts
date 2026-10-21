/**
 * Human-readable presentation metadata for immutable project events.
 *
 * @packageDocumentation
 */

import {
  matchProjectEvent,
  type ProjectEvent,
  type ProjectEventCases
} from '$lib/shared/projects/events';
import { plainMessageText } from '$lib/shared/projects/events/message-content';
import {
  isSverlinPresentation,
  presentationScenarioKey,
  presentationViewSeed
} from '$lib/shared/presentations';

/** Icon families available to Timeline event cards. */
export type TimelineEventIcon =
  | 'assistant'
  | 'code'
  | 'default'
  | 'failure'
  | 'message'
  | 'visualization';

/** Display text and styling derived from a project event. */
export type TimelineEventPresentation = {
  title: string;
  detail: string;
  icon: TimelineEventIcon;
  progress: string;
  tone: 'default' | 'destructive';
};

const presenters = {
  'project.created': (event) =>
    details('Project created', event.payload.title, 'default', 'Creating the project…'),
  'project.renamed': (event) =>
    details('Project renamed', event.payload.title, 'default', 'Updating the project…'),
  'operation.accepted': (event) =>
    details(
      'Operation accepted',
      operationLabel(event.payload.kind),
      'default',
      `${operationLabel(event.payload.kind)}…`
    ),
  'operation.completed': (event) =>
    details('Operation completed', operationLabel(event.payload.kind), 'default', 'Finishing…'),
  'operation.failed': (event) =>
    details(
      'Operation failed',
      event.payload.message,
      'failure',
      'Finishing with an error…',
      'destructive'
    ),
  'feedback.submitted': (event) =>
    details(
      'Feedback submitted',
      plainMessageText(event.payload.content),
      'message',
      'Feedback recorded…'
    ),
  'assistant.turn-requested': (event) =>
    details(
      'Assistant turn queued',
      `Interaction ${event.payload.interactionEventId}`,
      'assistant',
      'Feedback queued…'
    ),
  'assistant.turn-started': (event) =>
    details(
      'Assistant turn started',
      `${event.payload.interactionEventIds.length} interaction(s)`,
      'assistant',
      'Considering your feedback…'
    ),
  'assistant.intake-completed': (event) =>
    details(
      'Participant intake completed',
      event.payload.outcome,
      'assistant',
      'Preparing the visualization…'
    ),
  'visualization.candidates-advanced': (event) =>
    details(
      'Visualization candidates advanced',
      `${event.payload.presentations.length} presentation(s) · ${event.payload.reason}`,
      'visualization',
      'Loading the next visualizations…'
    ),
  'ai.generation-requested': (event) =>
    details(
      `AI generation requested · attempt ${event.payload.attempt}`,
      `${event.payload.requestedModel} · ${event.payload.purpose}`,
      'assistant',
      event.payload.purpose === 'fallback'
        ? 'Preparing a simpler working visualization…'
        : event.payload.purpose === 'repair'
          ? 'Repairing generated source…'
          : event.payload.purpose === 'intake'
            ? 'Considering your response…'
            : event.payload.purpose === 'choosing'
              ? 'Choosing how the visualizations look…'
              : 'Generating a visualization…'
    ),
  'ai.generation-succeeded': (event) =>
    details(
      `AI generation completed · attempt ${event.payload.attempt}`,
      `${event.payload.model ?? event.payload.requestedModel} · ${event.payload.durationMs} ms`,
      'assistant',
      'Checking the generated source…'
    ),
  'ai.generation-failed': (event) =>
    details(
      `AI generation failed · attempt ${event.payload.attempt}`,
      event.payload.message,
      'failure',
      'Recording the AI failure…',
      'destructive'
    ),
  'build.requested': (event) =>
    details(
      'Presentation build requested',
      `${event.payload.sourceLabel} · seed ${event.payload.seed}`,
      'code',
      'Building generated source…'
    ),
  'build.succeeded': (event) =>
    details(
      'Presentation build succeeded',
      `${event.payload.durationMs} ms · ${event.payload.bundle.sha256.slice(0, 8)}`,
      'code',
      'Build succeeded; activating…'
    ),
  'build.failed': (event) =>
    details(
      'Presentation build failed',
      event.payload.diagnostics[0]?.message ?? event.payload.error ?? event.payload.failureKind,
      'failure',
      event.payload.repairEligible
        ? 'Build failed; checking repair…'
        : 'Recording the build failure…',
      'destructive'
    ),
  'revision.edits-rejected': (event) =>
    details(
      'Edits not applied',
      event.payload.problems[0] ?? 'The edits could not be placed in the source.',
      'failure',
      'Edits did not apply; checking repair…',
      'destructive'
    ),
  'artifact.version-created': (event) =>
    details(
      'Artifact version created',
      event.payload.changes
        .map((change) =>
          change.operation === 'delete' ? `Deleted ${change.artifactId}` : change.artifact.path
        )
        .join(', '),
      'code',
      'Loading the updated artifact…'
    ),
  'visualization.presented': (event) =>
    details(
      `Visualization presented · ${isSverlinPresentation(event.payload.presentation) ? `seed ${presentationViewSeed(event.payload.presentation)}` : 'HTML'}`,
      isSverlinPresentation(event.payload.presentation)
        ? presentationScenarioKey(event.payload.presentation)
        : event.payload.presentation.stepSignature,
      'visualization',
      'Loading the visualization…'
    ),
  'visualization.preference-recorded': (event) =>
    details(
      'Visualization preference recorded',
      `Preferred presentation ${event.payload.preferred} at step ${event.payload.step + 1}`,
      'visualization',
      'Recording the preference…'
    ),
  'assistant.responded': (event) =>
    details(
      'Assistant responded',
      plainMessageText(event.payload.content),
      'assistant',
      'Finishing…'
    ),
  'visualization.runtime-failed': (event) =>
    details(
      'Visualization failed while drawing',
      `${event.payload.step === undefined ? '' : `Step ${event.payload.step + 1} · `}${event.payload.message}`,
      'failure',
      'Recording the failure…',
      'destructive'
    ),
  'system.notified': (event) =>
    details(
      'System notice',
      event.payload.message,
      event.payload.severity === 'error' ? 'failure' : 'default',
      event.payload.severity === 'error' ? 'Finishing with an error…' : 'Finishing…',
      event.payload.severity === 'error' ? 'destructive' : 'default'
    )
} satisfies ProjectEventCases<TimelineEventPresentation>;

/** Convert a typed project event into its Timeline presentation. */
export function presentProjectEvent(event: ProjectEvent): TimelineEventPresentation {
  return matchProjectEvent(event, presenters);
}

function details(
  title: string,
  detail: string,
  icon: TimelineEventIcon,
  progress: string,
  tone: TimelineEventPresentation['tone'] = 'default'
): TimelineEventPresentation {
  return { title, detail, icon, progress, tone };
}

function operationLabel(kind: string): string {
  return kind.replaceAll('-', ' ');
}
