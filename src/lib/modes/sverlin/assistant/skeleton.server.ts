/**
 * Skeletons: a Sverlin source with holes, which the main agent writes and the helpers fill. A hole
 * is `<Hole name="page" kind="layout" task="the graph large, the queue under it" />`, allowed only in
 * a skeleton, never in a source that builds. Its kind says what a fill must be: a view, a layout,
 * one or more cases, the algorithm, or anything. A view or layout hole may name what it replaces
 * with `of` (a view's type, a layout's name). Holes with the same `group` must suit each other, as a
 * graph's layout and its input, and one helper fills them together as one option; every other hole
 * is filled on its own, and its fills combine with the other holes' fills.
 *
 * A helper returns fills only, and the app puts each in its hole, so nothing outside the holes can
 * change.
 */

import { holeKinds, type HoleKind } from '$lib/server/ai/bots/helper-pipeline';
import { layoutBlock, withView } from './view-helpers.server';

export type Hole = {
  name: string;
  kind: HoleKind;
  task: string;
  /** The type a view hole draws, or the layout a layout hole replaces. */
  of?: string;
  /** Holes of one group are filled together; a hole without one is its own group. */
  group: string;
  /** Where the hole's tag is in the skeleton. */
  start: number;
  end: number;
};

const holeTag = /<Hole\b([^>]*?)\/>/gu;
const attribute = /(\w+)="([^"]*)"/gu;

/** The holes of a skeleton, in order, or the problems that make it no skeleton. */
export function holesOf(skeleton: string): { holes: Hole[] } | { problems: string[] } {
  const holes: Hole[] = [];
  const problems: string[] = [];
  for (const match of skeleton.matchAll(holeTag)) {
    const props = Object.fromEntries(
      [...match[1].matchAll(attribute)].map(([, key, value]) => [key, value])
    );
    const { name, kind, task, of, group } = props;
    if (!name || !/^\w+$/u.test(name)) {
      problems.push(`A hole needs a name of letters, digits and _: ${match[0]}`);
      continue;
    }
    if (!holeKinds.includes(kind as HoleKind)) {
      problems.push(`The hole ${name} needs kind="${holeKinds.join('|')}".`);
      continue;
    }
    if (holes.some((hole) => hole.name === name)) problems.push(`Two holes are named ${name}.`);
    holes.push({
      name,
      kind: kind as HoleKind,
      task: task ?? '',
      ...(of ? { of } : {}),
      group: group || name,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  if (!holes.length && !problems.length)
    problems.push('The skeleton has no <Hole name="…" kind="…" task="…" />.');
  if (/<Hole\b(?![^>]*\/>)/u.test(skeleton))
    problems.push('Every <Hole> closes itself, as <Hole name="page" kind="layout" task="…" />.');
  return problems.length ? { problems } : { holes };
}

/** The groups of holes filled together, in the order their first hole appears. */
export function holeGroups(holes: readonly Hole[]): Hole[][] {
  const groups = new Map<string, Hole[]>();
  for (const hole of holes) groups.set(hole.group, [...(groups.get(hole.group) ?? []), hole]);
  return [...groups.values()];
}

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

/** Why a fill is not of its hole's kind, or undefined where it is. */
export function fillProblem(hole: Hole, fill: string): string | undefined {
  const text = fill.trim();
  if (!text) return `The fill of ${hole.name} is empty.`;
  if (/<Hole\b/u.test(text)) return `The fill of ${hole.name} has a hole of its own.`;
  switch (hole.kind) {
    case 'view': {
      if (count(text, /<View\b/gu) !== 1 || !/^<View\b[\s\S]*<\/View>$/u.test(text))
        return `The fill of ${hole.name} must be one <View>…</View> and nothing else.`;
      if (hole.of && !new RegExp(`^<View\\b[^>]*\\bof="${hole.of}"`, 'u').test(text))
        return `The fill of ${hole.name} must be a view of ${hole.of}, as <View of="${hole.of}" name="…">.`;
      return undefined;
    }
    case 'layout': {
      if (count(text, /<Layout\b/gu) !== 1 || !/^<Layout\b[\s\S]*<\/Layout>$/u.test(text))
        return `The fill of ${hole.name} must be one <Layout>…</Layout> and nothing else.`;
      if (hole.of && !new RegExp(`^<Layout\\b[^>]*\\bname="${hole.of}"`, 'u').test(text))
        return `The fill of ${hole.name} must be the layout ${hole.of}, as <Layout name="${hole.of}">.`;
      return undefined;
    }
    case 'case':
      return text.replace(/<Case\b[\s\S]*?\/>/gu, '').trim() || !/<Case\b/u.test(text)
        ? `The fill of ${hole.name} must be one or more <Case … /> and nothing else.`
        : undefined;
    case 'algorithm':
      return count(text, /<script\b/gu) !== 1 ||
        !/^<script algorithm>[\s\S]*<\/script>$/u.test(text)
        ? `The fill of ${hole.name} must be one <script algorithm>…</script> and nothing else.`
        : undefined;
    case 'any':
      return undefined;
  }
}

/**
 * The source a skeleton makes with a fill in each hole, or why it makes none: a hole without a fill,
 * a fill for no hole, or a fill not of its hole's kind.
 */
export function fillSkeleton(
  skeleton: string,
  fills: Readonly<Record<string, string>>
): { source: string } | { problems: string[] } {
  const parsed = holesOf(skeleton);
  if ('problems' in parsed) return parsed;
  const problems = [
    ...parsed.holes.flatMap((hole) =>
      fills[hole.name] === undefined
        ? [`The hole ${hole.name} has no fill.`]
        : [fillProblem(hole, fills[hole.name])].filter((problem) => problem !== undefined)
    ),
    ...Object.keys(fills)
      .filter((name) => !parsed.holes.some((hole) => hole.name === name))
      .map((name) => `The skeleton has no hole named ${name}.`)
  ];
  if (problems.length) return { problems };
  let source = '';
  let at = 0;
  for (const hole of parsed.holes) {
    source += skeleton.slice(at, hole.start) + fills[hole.name].trim();
    at = hole.end;
  }
  return { source: source + skeleton.slice(at) };
}

const attributeText = (value: string) => value.replace(/"/gu, '“').replace(/[<>]/gu, '');

/**
 * The skeleton of an older request, a view of one type or another arrangement of one layout: the
 * source with a view hole after its views, or with a hole in place of the layout, and what each hole
 * held before, which fills it while other holes are tried.
 */
export function skeletonFor(
  source: string,
  request: { type?: string; layout?: string; task?: string }
): { skeleton: string; originals: Record<string, string> } | undefined {
  if (request.layout !== undefined) {
    const block = layoutBlock(source, request.layout);
    if (!block) return undefined;
    const task = attributeText(request.task ?? `another arrangement of ${request.layout}`);
    const hole = `<Hole name="layout" kind="layout" of="${request.layout}" task="${task}" />`;
    return { skeleton: source.replace(block, hole), originals: { layout: block } };
  }
  if (request.type === undefined) return undefined;
  const task = attributeText(request.task ?? `another view of ${request.type}`);
  const hole = `<Hole name="view" kind="view" of="${request.type}" task="${task}" />`;
  return { skeleton: withView(source, hole), originals: {} };
}
