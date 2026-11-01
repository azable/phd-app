/** Main counterbalanced single-component Svelte-versus-static-HTML study protocol. */

import { defineStudy, minutes } from '$lib/shared/study/definition';

export const mainStudy = defineStudy({
  id: 'main-study',
  version: 1,
  name: 'Main study',
  description: 'Counterbalanced comparison of single-component Svelte and static HTML frames.',
  assignment: {
    strategy: 'balanced',
    tieBreakOrder: ['sverlin-first', 'html-first']
  },
  interactionCapture: {
    schemaVersion: 1,
    // Four samples per second retain a recognizable path without recording video-like motion.
    cursorSampleIntervalMs: 250,
    cursorChunkDurationMs: 5_000,
    // Five seconds keeps ordinary delivery prompt while remaining well below the batch rate limit.
    flushIntervalMs: 5_000,
    flushRecordThreshold: 50,
    flushByteThreshold: 32 * 1024,
    // Periodic complete state makes later replay resilient to missing incremental observations.
    checkpointIntervalMs: 30_000,
    // One snapshot per second shows typing progression without storing per-key events.
    draftSnapshotIntervalMs: 1_000,
    // Five MiB comfortably covers both tasks while placing a hard bound on participant devices.
    outboxByteLimit: 5 * 1024 * 1024,
    // Same-day delivery recovers a temporarily offline browser without extending data collection.
    lateDeliverySeconds: 24 * 60 * 60
  },
  conditions: {
    sverlin: {
      mode: 'sverlin',
      // No buffer target: nothing refills pairs in the background, so pairs are only the
      // assistant's comparisons, and the stage shows one version otherwise (questionPairs in
      // ProjectWorkspace.svelte).
      workspace: { view: 'participant', layout: 'comparison' },
      project: { templateId: 'blank' },
      durationSeconds: minutes(15)
    },
    html: {
      mode: 'html',
      workspace: { view: 'participant', layout: 'single' },
      project: { templateId: 'blank' },
      durationSeconds: minutes(15)
    }
  },
  arms: {
    'sverlin-first': { slots: { first: 'sverlin', second: 'html' } },
    'html-first': { slots: { first: 'html', second: 'sverlin' } }
  },
  flow: [
    {
      id: 'welcome',
      kind: 'instruction',
      title: 'Welcome',
      paragraphs: [
        'You will complete two visualization tasks.',
        'Each task lasts 15 minutes and uses a different visualization system.',
        'Please notify the researcher before starting this task.'
      ],
      continueLabel: 'Begin first task'
    },
    {
      id: 'task-one',
      kind: 'task',
      conditionSlot: 'first',
      instructions: {
        title: 'Visualization task',
        prompt: 'Create and refine an algorithm visualization of your choice.'
      }
    },
    {
      id: 'between-tasks',
      kind: 'instruction',
      title: 'First task complete',
      paragraphs: [
        'The next task uses a different visualization system.',
        'Please notify the researcher before starting this task.'
      ],
      continueLabel: 'Begin second task'
    },
    {
      id: 'task-two',
      kind: 'task',
      conditionSlot: 'second',
      instructions: {
        title: 'Visualization task',
        prompt: 'Create and refine an algorithm visualization of your choice.'
      }
    },
    {
      id: 'complete',
      kind: 'completion',
      title: 'Study complete',
      paragraphs: ['Thank you. Your responses have been recorded.']
    }
  ]
});
