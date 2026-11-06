/**
 * The scoring stage of the helper pipeline (ai/bots/helper-pipeline.ts): a decision model looks at
 * pictures of each option and answers fixed questions, each with the probability of each answer,
 * and the shortlist of each group is its best options. A component, as a view drawn alone, is asked
 * about itself; a part in context, as a layout in the whole picture, about the picture. With
 * scoring off, or where pictures or the model are unavailable, the app's own measure ranks them.
 * Mode-neutral: a mode gives the pictures and its measure.
 */

import {
  createDecisions,
  maximumDecisionImages,
  optionProbabilities,
  type ChoiceQuestion,
  type DecisionsRequest,
  type DecisionsResponse
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

const yesNo = [
  { value: true, description: 'yes' },
  { value: false, description: 'no' }
];

/**
 * What a component drawn alone is asked: each question says yes for a good one. A view is judged by
 * itself, a few of its values side by side, so the questions are about how it draws a value.
 */
export const componentQuestions: ChoiceQuestion[] = [
  {
    type: 'choice',
    name: 'readable',
    instructions: 'Is the value each drawing shows easy to read at this size?',
    choices: yesNo
  },
  {
    type: 'choice',
    name: 'state_clear',
    instructions:
      'Where a drawing shows a state, as current, visited, sorted or done, is that state clear at a glance?',
    choices: yesNo
  },
  {
    type: 'choice',
    name: 'distinct',
    instructions: 'Do values drawn differently look clearly different from one another?',
    choices: yesNo
  }
];

/**
 * What a part shown in the whole picture is asked, over the first step, the fullest, and the last,
 * in order: each question says yes for a good one.
 */
export const contextQuestions: ChoiceQuestion[] = [
  {
    type: 'choice',
    name: 'no_overlap',
    instructions:
      'Are the pictures free of labels, marks or shapes that overlap or cover each other?',
    choices: yesNo
  },
  {
    type: 'choice',
    name: 'text_readable',
    instructions: 'Can every text be read at the size shown?',
    choices: yesNo
  },
  {
    type: 'choice',
    name: 'focus_clear',
    instructions:
      'Going from one picture to the next, is the part that changes, the focus of the step, easy to find?',
    choices: yesNo
  }
];

/** What one option was scored: the share of good answers, and each question's probability. */
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

/** An answer's probability of "yes", the chosen answer standing in where none come back. */
const yesProbability = (response: DecisionsResponse, question: ChoiceQuestion) => {
  const answer = response.answers.find((each) => each.name === question.name);
  if (!answer || answer.type === 'refusal') return undefined;
  return optionProbabilities(answer, question.choices).get(true) ?? 0;
};

/**
 * Score every option at once, one request each: the score is the mean probability of "yes" over
 * its questions. An option whose call fails, or with no pictures, has no score.
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
              const yes = yesProbability(response, question);
              return yes === undefined ? [] : [[question.name, yes]];
            })
          );
          const values = Object.values(answers);
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
