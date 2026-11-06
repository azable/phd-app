/** Primary single-component Svelte visualization assistant. */

import {
  generatedMessageContentSchema,
  parseRecoveryExplanation,
  recoveryExplanationJsonSchema,
  needsMoreThoughtJsonSchema,
  parseNeedsMoreThought,
  generatedMessageContentJsonSchema,
  maximumViewHelpersTask,
  type ChatBotConfig,
  type ChatResponseFormat,
  type ViewHelpersRequest
} from '$lib/server/ai/bots/types';
import { visualizationAttemptProfiles } from '$lib/server/ai/bots/attempt-profiles';
import {
  briefUpdateJsonSchema,
  briefUpdateSchema,
  recordedBrief,
  sourceDecisionJsonSchema,
  sourceDecisionSchema
} from '$lib/server/ai/decisions/source-decisions';
import { visualizationParticipantIntake } from '$lib/server/ai/bots/participant-intake';
import * as v from 'valibot';
import type { AiProjectContext } from '$lib/server/ai/context/project-context';

import type { DesignForAssistant } from '$lib/modes/assistants.server';
import { designContext, designVariables } from './context.server';
import assistant from './assistant.md?raw';

/** How a recorded decision's design values are read (see ../../assistants.server.ts). */
export { readDesignPatch as readDecisionValues } from './design-patch.server';

/** How the assistant is told a version's arrangements (see ../../assistants.server.ts). */
export { arrangementsText as tellArrangements } from './arrangements.server';

/** The design as the assistant reads it (see ../../assistants.server.ts). */
export const design: DesignForAssistant = { variables: designVariables, context: designContext };

/** What a Sverlin workspace offers beyond every mode's, for the assistant (see project-context.ts). */
export const interfaceCapabilities = [
  'selected.elements traces each element a participant referenced to the <Node> tag that drew it.',
  'A project may keep another pair generated ahead of time; ordinary conversation does not advance the visible pair.'
];
import guide from '../README.md?raw';
import { listingMapsOf, recordedTrace } from '../compile.server';

/** Prompt text from a Markdown file: its HTML comments are notes for maintainers. */
const promptText = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->\s*/gu, '').trim();
const instructions = promptText(assistant);
export const languageGuide = promptText(guide);

/**
 * At most this much of the recorded steps, as JSON, goes into the assistant's context: about 5,000
 * tokens, a fraction of the guide it is sent with, and enough for the small inputs examples use.
 */
const maximumTraceCharacters = 20_000;

/**
 * The steps a source's algorithm records, for the assistant to check what its algorithm does and
 * to name what a step shows: each step by its name with its variables in scope, as many steps as
 * fit, or why there are none.
 */
export function recordedSteps(source: string): Record<string, unknown> {
  let trace;
  try {
    trace = recordedTrace(source);
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
  const steps: { name: string; state: unknown }[] = [];
  let length = 0;
  for (const [index, { name, state }] of trace.entries()) {
    const entry = { name: name ?? `step ${index + 1}`, state };
    length += JSON.stringify(entry).length;
    if (length > maximumTraceCharacters) break;
    steps.push(entry);
  }
  return {
    steps,
    ...(steps.length < trace.length ? { omittedSteps: trace.length - steps.length } : {})
  };
}

/**
 * What each region of the source's own listings is mapped to, so the assistant can check its labels;
 * the problem, where the source has one, is in the recorded steps or the build's feedback.
 */
function listingMaps(source: string): Record<string, unknown> | undefined {
  try {
    return listingMapsOf(source);
  } catch {
    return undefined;
  }
}

/** The reply, its decision, the brief it updates, and a fallback's recovery. */
const responseFormat = {
  name: 'chat_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: generatedMessageContentJsonSchema,
      decision: sourceDecisionJsonSchema,
      brief: briefUpdateJsonSchema,
      recovery: recoveryExplanationJsonSchema,
      needsMoreThought: needsMoreThoughtJsonSchema
    },
    required: ['reply', 'decision', 'brief', 'recovery', 'needsMoreThought']
  }
} satisfies ChatResponseFormat;

/** The same, with the type the view helpers should propose views of and their task, or null. */
const responseFormatWithViewHelpers = {
  ...responseFormat,
  schema: {
    ...responseFormat.schema,
    properties: {
      ...responseFormat.schema.properties,
      viewHelpers: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                description:
                  'The type of the source to propose views of, as Card, or an empty string to propose arrangements of a layout.'
              },
              layout: {
                type: 'string',
                description:
                  'The layout of the source to propose arrangements of, as Main, or an empty string to propose views of a type.'
              },
              task: {
                type: 'string',
                description:
                  'What the views should show, in one short sentence from what the participant asked and settled, or an empty string.'
              }
            },
            required: ['type', 'layout', 'task']
          },
          { type: 'null' }
        ],
        description:
          'What the view helpers should propose alternative views of after this reply, or null.'
      }
    },
    required: [...responseFormat.schema.required, 'viewHelpers']
  }
} satisfies ChatResponseFormat;

/** Primary visualization-authoring chatbot definition. */
export default {
  id: 'sverlin-assistant',
  participantIntake: visualizationParticipantIntake,
  initialPrompt: [instructions, languageGuide].join('\n\n'),
  buildContext: ({ project, attempt, buildFeedback }) => {
    // A repair reads the steps of the candidate that failed; otherwise those of the current source.
    const { entryArtifactId, artifacts } = project.base;
    const source =
      buildFeedback?.failedSource ??
      artifacts.find(({ artifactId }) => artifactId === entryArtifactId)?.source;
    const maps = source ? listingMaps(source) : undefined;
    return {
      project,
      attemptContext: attempt,
      ...(buildFeedback ? { buildFeedback } : {}),
      ...(source ? { recordedSteps: recordedSteps(source) } : {}),
      ...(maps ? { listingMaps: maps } : {})
    };
  },
  attemptProfiles: visualizationAttemptProfiles(12000),
  responseFormat,
  // Where the view helpers are on, the reply may name a type for them (see view-helpers.ts).
  responseFormatFor: ({ project }) =>
    project.viewHelpers ? responseFormatWithViewHelpers : responseFormat,
  parseOutput(value) {
    const output = value as {
      reply?: unknown;
      decision?: unknown;
      brief?: unknown;
      recovery?: unknown;
      viewHelpers?: unknown;
      needsMoreThought?: unknown;
    };
    const decision = v.safeParse(sourceDecisionSchema, output?.decision);
    if (!decision.success) throw new Error('The chatbot returned an invalid structured response.');
    const recovery = parseRecoveryExplanation(output.recovery);
    // A brief that does not parse is left out rather than costing the turn a repair.
    const brief = v.safeParse(briefUpdateSchema, output.brief);
    const entries = brief.success ? recordedBrief(brief.output) : [];
    return {
      reply: v.parse(generatedMessageContentSchema, output.reply),
      decision: decision.output,
      ...(entries.length ? { brief: entries } : {}),
      ...(recovery ? { recovery } : {}),
      ...viewHelpersRequest(output.viewHelpers),
      ...(parseNeedsMoreThought(output.needsMoreThought) ? { needsMoreThought: true } : {})
    };
  }
} satisfies ChatBotConfig<AiProjectContext>;

/**
 * The view helpers' request in a reply: a type and a task, or, from turns before tasks, a type
 * alone. None where it names no type.
 */
export function viewHelpersRequest(value: unknown): { viewHelpers?: ViewHelpersRequest } {
  const { type, layout, task } =
    typeof value === 'string'
      ? { type: value, layout: undefined, task: undefined }
      : ((value ?? {}) as { type?: unknown; layout?: unknown; task?: unknown });
  const asked = typeof task === 'string' ? task.trim().slice(0, maximumViewHelpersTask) : '';
  const tasked = asked ? { task: asked } : {};
  if (typeof layout === 'string' && layout.trim())
    return { viewHelpers: { layout: layout.trim(), ...tasked } };
  if (typeof type !== 'string' || !type.trim()) return {};
  return { viewHelpers: { type: type.trim(), ...tasked } };
}
