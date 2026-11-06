/**
 * Each mode's assistant, found by folder convention from the public catalogue, as `server.ts`
 * finds each mode's builders: its bot (`assistant/bot.server.ts`), and for a mode with a design
 * space, how it reads the design values a recorded decision set.
 */

import { modeCatalog } from './catalog';
import type { VisualizationMode } from '$lib/shared/presentations';
import type { AiProjectContext } from '$lib/server/chat-bots/project-context';
import type {
  CandidateAssistantOutput,
  ChatBotConfig,
  SourceArtifactChatOutput
} from '$lib/server/ai/bots/types';

type ModeOutput = SourceArtifactChatOutput | CandidateAssistantOutput;

/** The values a decision's design field sets, by written key, or why it could not be read. */
export type DecisionValuesReader = (
  values: unknown
) => { set: { variable: string; value: string | number | boolean }[] } | { problem: string };

type AssistantModule = {
  default: ChatBotConfig<AiProjectContext, ModeOutput>;
  readDecisionValues?: DecisionValuesReader;
};

const modules = import.meta.glob<AssistantModule>('./*/assistant/bot.server.ts', { eager: true });

for (const pathname of Object.keys(modules)) {
  const id = pathname.split('/').at(-3) ?? '';
  if (!(id in modeCatalog)) throw new Error(`Unregistered visualization mode folder ${id}.`);
}

/** Each mode's assistant module, checked to be the bot the catalogue names. */
export const modeAssistants = Object.fromEntries(
  Object.keys(modeCatalog).map((mode) => {
    const module = modules[`./${mode}/assistant/bot.server.ts`];
    if (!module || module.default.id !== modeCatalog[mode as VisualizationMode].assistantId)
      throw new Error(`Visualization mode ${mode} needs its own matching assistant.`);
    return [mode, module];
  })
) as Record<VisualizationMode, AssistantModule>;

/**
 * How the mode with a design space reads a decision's design values, for code that reads recorded
 * decisions without a project's mode, as the preference model; none where no mode has one.
 */
export const readDecisionValues: DecisionValuesReader = (() => {
  const all = Object.values(modules).flatMap(({ readDecisionValues }) =>
    readDecisionValues ? [readDecisionValues] : []
  );
  if (all.length > 1) throw new Error('More than one mode reads design values; pass the mode.');
  return all[0] ?? (() => ({ set: [] }));
})();
