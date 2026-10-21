/**
 * Each request the project made to a model, for audit: the prompt as sent, the response or failure,
 * and what followed in the same operation until its next request, read from the recorded events.
 *
 * @packageDocumentation
 */

import type { ProjectEvent, ProjectEventOf } from '$lib/shared/projects/events';

/** One model request with what came of it. */
export type AgentRequest = {
  request: ProjectEventOf<'ai.generation-requested'>;
  outcome?: ProjectEventOf<'ai.generation-succeeded'> | ProjectEventOf<'ai.generation-failed'>;
  /** The operation's events after the outcome, up to its next request. */
  actions: ProjectEvent[];
  /** Whether another request in the operation followed, as a repair does. */
  followed: boolean;
};

/** The prompt as sent: instructions, conversation, context, parameters, and response schema. */
export type AgentPrompt = {
  initialPrompt?: string;
  messages?: { role: string; content: string }[];
  context?: unknown;
  parameters?: unknown;
  responseFormat?: unknown;
  attempt?: unknown;
};

/** What the model decided, where its response holds a structured decision. */
export type AgentDecision = {
  reply?: unknown;
  decision?: {
    action?: string;
    summary?: string;
    edits?: { find: string; replace: string }[];
    sourceArtifactContent?: string | null;
  };
  recovery?: unknown;
};

/** The model requests among one operation's events, each with its outcome and what followed. */
export function agentRequests(related: readonly ProjectEvent[]): AgentRequest[] {
  const requests: AgentRequest[] = [];
  for (const event of related) {
    if (event.type === 'ai.generation-requested') {
      const previous = requests.at(-1);
      if (previous) previous.followed = true;
      requests.push({ request: event, actions: [], followed: false });
      continue;
    }
    const current = requests.at(-1);
    if (!current) continue;
    if (
      !current.outcome &&
      (event.type === 'ai.generation-succeeded' || event.type === 'ai.generation-failed')
    )
      current.outcome = event;
    else current.actions.push(event);
  }
  return requests;
}

/** A recorded prompt, parsed, or undefined where it is not JSON. */
export function agentPrompt(request: AgentRequest): AgentPrompt | undefined {
  return parsed(request.request.payload.prompt.text) as AgentPrompt | undefined;
}

/**
 * The decision in a recorded response: the provider's output text, where the response is a
 * provider's envelope around it, or the response itself.
 */
export function agentDecision(request: AgentRequest): AgentDecision | undefined {
  if (request.outcome?.type !== 'ai.generation-succeeded') return undefined;
  const response = parsed(request.outcome.payload.response.text) as
    | (AgentDecision & { output_text?: string })
    | undefined;
  if (typeof response?.output_text === 'string')
    return parsed(response.output_text) as AgentDecision | undefined;
  return response;
}

/** A card's one-line account of a request: what the model decided, and what came of it. */
export function agentOutcome(request: AgentRequest): string {
  const { outcome, actions, followed } = request;
  if (!outcome) return 'Waiting for the model';
  if (outcome.type === 'ai.generation-failed') return `Failed (${outcome.payload.failureKind})`;
  const decision = agentDecision(request)?.decision;
  const action = decision?.action;
  const said =
    action === 'edit'
      ? `Edit · ${decision?.edits?.length ?? 0} ${decision?.edits?.length === 1 ? 'edit' : 'edits'}`
      : action === 'revise'
        ? 'Rewrite'
        : action === 'resample'
          ? 'Resample'
          : action === 'respond'
            ? 'Reply'
            : 'Response';
  const built = actions.some(({ type }) => type === 'build.succeeded');
  const failed = actions.some(({ type }) => type === 'build.failed');
  const versioned = actions.some(({ type }) => type === 'artifact.version-created');
  // An edit that could not be placed is not built: the next request is its repair.
  const result = failed
    ? 'build failed'
    : versioned
      ? 'new version'
      : action === 'edit' && !built && followed
        ? 'edits did not apply'
        : undefined;
  return result ? `${said} → ${result}` : said;
}

/** Tokens read and written, where the provider reported them. */
export function agentTokens(request: AgentRequest): { read?: number; written?: number } {
  if (request.outcome?.type !== 'ai.generation-succeeded') return {};
  const usage = request.outcome.payload.usage ?? {};
  return { read: usage.inputTokens, written: usage.outputTokens };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The request a model was sent at an event, with what came of it, if that event is one. */
export function agentRequestAt(
  events: readonly ProjectEvent[],
  eventId: number
): AgentRequest | undefined {
  const event = events.find(({ id }) => id === eventId);
  if (!event) return undefined;
  return agentRequests(events.filter(({ operationId }) => operationId === event.operationId)).find(
    ({ request }) => request.id === eventId
  );
}
