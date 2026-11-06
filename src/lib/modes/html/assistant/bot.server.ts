/** Direct static-HTML visualization authoring configuration. */

import * as v from 'valibot';

import { htmlFramesManifestSchema, type HtmlFramesManifest } from '$lib/shared/presentations';

import type { AiProjectContext } from '$lib/server/ai/context/project-context';
import {
  generatedMessageContentJsonSchema,
  generatedMessageContentSchema,
  parseRecoveryExplanation,
  recoveryExplanationJsonSchema,
  type ChatBotConfig,
  type GeneratedMessageContent,
  type RecoveryExplanation
} from '$lib/server/ai/bots/types';
import { visualizationAttemptProfiles } from '$lib/server/ai/bots/attempt-profiles';
import { visualizationParticipantIntake } from '$lib/server/ai/bots/participant-intake';

import assistant from './assistant.md?raw';

/** The instructions as one paragraph: the file's maintainer comments out, its wrapped lines joined. */
export const htmlInstructions = assistant
  .replace(/<!--[\s\S]*?-->/gu, '')
  .trim()
  .replace(/\s*\n\s*/gu, ' ');

export type HtmlAssistantOutput = {
  reply: GeneratedMessageContent;
  candidates: Array<{ label: string; manifest: HtmlFramesManifest }>;
  recovery?: RecoveryExplanation;
};

export default {
  id: 'html-assistant',
  participantIntake: visualizationParticipantIntake,
  initialPrompt: htmlInstructions,
  buildContext: ({ project, attempt }) => ({ project, attemptContext: attempt }),
  attemptProfiles: visualizationAttemptProfiles(14000),
  responseFormat: {
    name: 'html_visualization_turn',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: generatedMessageContentJsonSchema,
        candidates: {
          type: 'array',
          minItems: 0,
          maxItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', minLength: 1, pattern: '\\S' },
              manifest: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  format: { type: 'string', enum: ['sverlin-html-frames'] },
                  version: { type: 'integer', enum: [1] },
                  frames: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        label: { type: 'string', minLength: 1 },
                        html: { type: 'string', minLength: 1 }
                      },
                      required: ['label', 'html']
                    }
                  }
                },
                required: ['format', 'version', 'frames']
              }
            },
            required: ['label', 'manifest']
          }
        },
        recovery: recoveryExplanationJsonSchema
      },
      required: ['reply', 'candidates', 'recovery']
    }
  },
  parseOutput(value) {
    const output = value as { reply?: unknown; candidates?: unknown; recovery?: unknown };
    if (!Array.isArray(output?.candidates) || output.candidates.length > 1) {
      throw new Error('The HTML assistant returned an invalid structured response.');
    }
    const recovery = parseRecoveryExplanation(output.recovery);
    return {
      reply: v.parse(generatedMessageContentSchema, output.reply),
      candidates: output.candidates.map((candidate) => {
        const value = candidate as { label?: unknown; manifest?: unknown };
        if (typeof value.label !== 'string' || !value.label.trim()) {
          throw new Error('Each HTML candidate needs a non-empty label.');
        }
        return {
          label: value.label.trim(),
          manifest: v.parse(htmlFramesManifestSchema, value.manifest)
        };
      }),
      ...(recovery ? { recovery } : {})
    };
  }
} satisfies ChatBotConfig<AiProjectContext, HtmlAssistantOutput>;
