/**
 * The scoring stage of the helper pipeline (ai/bots/helper-pipeline.ts): a decision model looks at
 * pictures of each option and answers fixed statements, each with the probability that it is true,
 * and the shortlist of each group is its best options. A component, as a view drawn alone, is asked
 * about itself; a part in context, as a layout in the whole picture, about the picture. With
 * scoring off, or where pictures or the model are unavailable, the app's own measure ranks them.
 * Mode-neutral: a mode gives the pictures and its measure.
 */

import {
  createDecisions,
  maximumDecisionImages,
  type DecisionsRequest,
  type DecisionsResponse,
  type PredicateQuestion
} from '$lib/server/ai/providers/openai-decisions';

/** One option to score: what it is, its group, what to ask, its pictures, and the app's facts. */
export type ScoringOption = {
  id: string;
  group: string;
  /** A component drawn alone, or a part shown in the whole picture over a few steps. */
  look: 'component' | 'context';
  pictures: readonly string[];
  /** The app's facts in a line, given as text beside the pictures. */
  facts: string;
  /** The app's own measure, which ranks options with no score (candidate-facts.server.ts). */
  measure: number;
};

/**
 * What a component drawn alone is asked: each statement is true of a good one. A view is judged by
 * itself, a few of its values side by side, so the statements are about how it draws a value.
 */
export const componentQuestions: PredicateQuestion[] = [
  {
    type: 'predicate',
    name: 'readable',
    instructions: 'The value each drawing shows is easy to read at this size.'
  },
  {
    type: 'predicate',
    name: 'shows_state',
    instructions: 'A drawing shows a state of its value, as current, visited, sorted or done.'
  },
  {
    type: 'predicate',
    name: 'state_clear',
    instructions:
      'Where a drawing shows a state, as current, visited, sorted or done, that state is clear at a glance.'
  },
  {
    type: 'predicate',
    name: 'distinct',
    instructions: 'Values drawn differently look clearly different from one another.'
  }
];

/**
 * What a part shown in the whole picture is asked, over the first step, the fullest, and the last,
 * in order: each statement is true of a good one.
 */
export const contextQuestions: PredicateQuestion[] = [
  {
    type: 'predicate',
    name: 'no_overlap',
    instructions: 'No labels, marks or shapes in the pictures overlap or cover each other.'
  },
  {
    type: 'predicate',
    name: 'text_readable',
    instructions: 'Every text can be read at the size shown.'
  },
  {
    type: 'predicate',
    name: 'focus_clear',
    instructions:
      'Going from one picture to the next, the part that changes, the focus of the step, is easy to find.'
  }
];

/**
 * Statements that only say whether another counts, by the one they decide: a view showing no state,
 * as a number, is not judged on how clear its state is (project f9cbf444's views of Int scored 0.06
 * there, pulling each score to about 0.48). The domain cannot say this: an enumeration is a state
 * (done) or a name (A), and a place's light is a state too, so the model judges it from the pictures.
 */
const countsWhere: Readonly<Record<string, string>> = { state_clear: 'shows_state' };
const deciding = new Set(Object.values(countsWhere));

/**
 * The statements an option's score is the mean of: not those that only decide, nor one whose
 * deciding statement is more likely false (one with no answer there counts).
 */
function counted(answers: Readonly<Record<string, number>>): number[] {
  return Object.entries(answers).flatMap(([name, probability]) => {
    const where = countsWhere[name];
    return deciding.has(name) || (where && (answers[where] ?? 1) < 0.5) ? [] : [probability];
  });
}

/** What one option was scored: the mean probability of its counted statements, and each one's. */
export type OptionScore = { score: number; answers: Record<string, number> };

/** One call to the decision model, for the Timeline and the logs. */
export type ScoringCall = {
  optionId: string;
  model: string;
  /** The request with each picture replaced by its place, as a picture is large. */
  request: unknown;
  durationMs: number;
  response?: DecisionsResponse;
  error?: unknown;
};

/** The request scoring one option: its facts and pictures, and its look's questions. */
export function scoringRequest(option: ScoringOption, model: string): DecisionsRequest {
  const questions = option.look === 'component' ? componentQuestions : contextQuestions;
  const lead =
    option.look === 'component'
      ? 'A view of one type of value, drawn alone for a few of its values, side by side.'
      : 'One visualization of an algorithm, at its first step, its fullest step, and its last.';
  return {
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${lead} Measured: ${option.facts}.` },
          ...option.pictures
            .slice(0, maximumDecisionImages)
            .map((url) => ({ type: 'input_image' as const, image_url: url }))
        ]
      }
    ],
    questions
  };
}

/** A request as recorded: each picture's data URL replaced by a short note of its size. */
export function recordedRequest(request: DecisionsRequest): unknown {
  if (typeof request.input === 'string') return request;
  return {
    ...request,
    input: request.input.map((message) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === 'input_image'
          ? { type: 'input_image', image_url: `[PNG, ${part.image_url.length} characters]` }
          : part
      )
    }))
  };
}

/** The probability that a question's statement is true; none for a refusal or a missing answer. */
const trueProbability = (response: DecisionsResponse, question: PredicateQuestion) => {
  const answer = response.answers.find((each) => each.name === question.name);
  if (!answer || answer.type === 'refusal') return undefined;
  return answer.probability;
};

/**
 * Score every option at once, one request each: the score is the mean probability of "true" over
 * its counted questions. An option whose call fails, or with no pictures, has no score.
 */
export async function scoreOptions(
  options: readonly ScoringOption[],
  model: string,
  decide: (
    request: DecisionsRequest,
    signal?: AbortSignal
  ) => Promise<DecisionsResponse> = createDecisions,
  signal?: AbortSignal
): Promise<{ scores: Map<string, OptionScore>; calls: ScoringCall[] }> {
  const scores = new Map<string, OptionScore>();
  const calls = await Promise.all(
    options
      .filter((option) => option.pictures.length)
      .map(async (option): Promise<ScoringCall> => {
        const request = scoringRequest(option, model);
        const started = performance.now();
        try {
          const response = await decide(request, signal);
          const answers = Object.fromEntries(
            request.questions.flatMap((question) => {
              const probability = trueProbability(response, question);
              return probability === undefined ? [] : [[question.name, probability]];
            })
          );
          const values = counted(answers);
          if (values.length)
            scores.set(option.id, {
              score: values.reduce((sum, value) => sum + value, 0) / values.length,
              answers
            });
          return {
            optionId: option.id,
            model,
            request: recordedRequest(request),
            durationMs: performance.now() - started,
            response
          };
        } catch (error) {
          return {
            optionId: option.id,
            model,
            request: recordedRequest(request),
            durationMs: performance.now() - started,
            error
          };
        }
      })
  );
  return { scores, calls };
}

/**
 * Each group's shortlist, its best `size` options: by score where it has one, an option with a
 * score before one without, then by the app's measure.
 */
export function shortlists<Option extends Pick<ScoringOption, 'id' | 'group' | 'measure'>>(
  options: readonly Option[],
  scores: ReadonlyMap<string, OptionScore>,
  size: number
): Map<string, Option[]> {
  const groups = new Map<string, Option[]>();
  for (const option of options)
    groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
  const rank = (option: Option) => scores.get(option.id)?.score ?? -1;
  return new Map(
    [...groups].map(([group, members]) => [
      group,
      members.toSorted((a, b) => rank(b) - rank(a) || b.measure - a.measure).slice(0, size)
    ])
  );
}

/** A Decisions API response's token use, in the names the Timeline records. */
export function decisionsUsage(response: DecisionsResponse): Record<string, number> | undefined {
  const usage = response.usage;
  if (!usage) return undefined;
  return {
    ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {})
  };
}
