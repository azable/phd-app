/**
 * What the app measures of a helper's candidate once built (design: "the app measures, the helper
 * does not"): its frame and content, shape, scale on the stage, text sizes, share of the frame
 * filled, parts, steps, the algorithm's labels that ran and did not, crossings, warnings, and
 * which of the main agent's constraints it met. These rank candidates when scoring is off and go
 * with each candidate to the scoring and choosing stages.
 */

import { layoutShape, unreadableProblem, type Readability } from '$lib/shared/readability';
import type { SvelteBundle } from '../compile.server';
import { stageCloseness } from './arrangements.server';

export type CandidateFacts = {
  frame: Readability['frame'];
  content: Readability['content'];
  /** The content's width over its height. */
  aspect: number;
  /** How large it shows on the typical stage, as a share of its written size. */
  scale: number;
  /** On-screen px of the text half the text is at or under, and of the smallest text. */
  text: number;
  smallest: number;
  /** The share of the frame the content covers; absent in builds that do not measure it. */
  fill?: number;
  parts: number;
  steps: number;
  /**
   * The labels the storyboard pauses at that some step shows, and those no step shows, as a branch
   * the case never takes. The build keeps only the steps it pauses at, so a label it does not pause
   * at cannot be told run or not.
   */
  labelsRun: string[];
  labelsNotRun: string[];
  /** Link crossings of the shown arrangement of a free layout, where it has one. */
  crossings?: number;
  warnings: string[];
  /** The main agent's constraints it met, broke, or the app cannot check. */
  constraints: { met: string[]; broken: string[]; unchecked: string[] };
  /** Readable text, then a shape near the stage's, then the frame filled, as arrangements rank. */
  score: number;
};

/** The facts of a build with no readability, a 1×1 nothing, so it ranks last. */
const unmeasured: Readability = {
  ratio: 'fit',
  frame: { width: 1, height: 1 },
  content: { width: 1, height: 1 },
  parts: [],
  row: false,
  scale: 1,
  text: 0,
  smallest: 0
};

/** The labels a source's scenes pause at, as written, as @insert.take. */
export function pausedLabels(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/\bpause="([^"]*)"/gu)].flatMap(([, list]) =>
        list
          .split(',')
          .map((label) => label.trim())
          .filter((label) => label.startsWith('@'))
      )
    )
  ];
}

/** The labels a step list shows, as @insert.take of @insert.take#2. */
const shownLabels = (steps: readonly string[]) =>
  new Set(steps.map((step) => step.replace(/#\d+$/u, '')));

/**
 * Whether one constraint holds, for the forms the app can check: "at most N steps", "every label
 * runs" (every label the scenes pause at shows at some step), "no crossings" or "no link
 * crossings", "text at least N px"; undefined for any other.
 */
function constraintHolds(constraint: string, facts: Omit<CandidateFacts, 'constraints' | 'score'>) {
  const text = constraint.toLowerCase();
  const most = /at most (\d+) steps/u.exec(text);
  if (most) return facts.steps <= Number(most[1]);
  if (/every label (runs|is run|shows)/u.test(text)) return facts.labelsNotRun.length === 0;
  if (/no (link )?crossings/u.test(text)) return (facts.crossings ?? 0) === 0;
  const least = /text at least (\d+)\s*px/u.exec(text);
  if (least) return facts.text >= Number(least[1]);
  return undefined;
}

/**
 * A built candidate's facts, or why it is left out: unreadable on the typical stage, or breaking a
 * constraint the app can check.
 */
export function candidateFacts(
  built: Pick<SvelteBundle, 'labels' | 'steps' | 'warnings' | 'layout'>,
  source: string,
  constraints: readonly string[] = []
): { facts: CandidateFacts } | { dropped: string } {
  // A build the server could not size, as one whose layout reported errors, is kept unmeasured,
  // ranked last, as the helpers' candidates were before facts.
  const readability = built.layout.readability ?? unmeasured;
  const unreadable = built.layout.readability && unreadableProblem(readability);
  if (unreadable) return { dropped: unreadable };
  const shown = shownLabels(built.steps);
  const declared = pausedLabels(source);
  const crossings = built.layout.arrangements?.find((arrangement) => arrangement.shown)?.crossings;
  const measured = {
    frame: readability.frame,
    content: readability.content,
    aspect: readability.content.width / readability.content.height,
    scale: readability.scale,
    text: readability.text,
    smallest: readability.smallest,
    ...(readability.fill !== undefined ? { fill: readability.fill } : {}),
    parts: readability.parts.length,
    steps: built.labels.length,
    labelsRun: declared.filter((label) => shown.has(label)),
    labelsNotRun: declared.filter((label) => !shown.has(label)),
    ...(crossings !== undefined ? { crossings } : {}),
    warnings: [...(built.warnings ?? []), ...built.layout.errors]
  };
  const met: string[] = [];
  const broken: string[] = [];
  const unchecked: string[] = [];
  for (const constraint of constraints) {
    const holds = constraintHolds(constraint, measured);
    (holds === undefined ? unchecked : holds ? met : broken).push(constraint);
  }
  if (broken.length) return { dropped: `breaks ${broken.join('; ')}` };
  const score = !built.layout.readability
    ? 0
    : 2 +
      3 * stageCloseness(readability) +
      (readability.fill ?? 0) -
      0.05 * Math.max(0, readability.parts.length - 1) -
      (crossings ?? 0) / 10;
  return { facts: { ...measured, constraints: { met, broken, unchecked }, score } };
}

/** A candidate's facts in a line, for the scoring and choosing stages and the assistant. */
export function factsText(facts: CandidateFacts, readability?: Readability): string {
  const shape = readability
    ? layoutShape(readability)
    : `${Math.round(facts.aspect * 10) / 10}:1, ${facts.parts} part${facts.parts === 1 ? '' : 's'}`;
  return [
    shape,
    `text ${Math.round(facts.text)} px (smallest ${Math.round(facts.smallest)})`,
    `${facts.steps} steps`,
    ...(facts.labelsNotRun.length ? [`labels never shown: ${facts.labelsNotRun.join(', ')}`] : []),
    ...(facts.crossings !== undefined ? [`${facts.crossings} crossings`] : []),
    ...(facts.warnings.length ? [`${facts.warnings.length} warnings`] : []),
    ...(facts.constraints.unchecked.length
      ? [`not checked: ${facts.constraints.unchecked.join('; ')}`]
      : [])
  ].join(', ');
}
