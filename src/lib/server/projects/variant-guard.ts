/**
 * Limits on what any chooser may hide, enforced in code whatever the chooser says: never a
 * top-level part (what the view's root renders, in any layout) or a node holding most of the picture, never what
 * the preference model settled (settledValues), at most one hide per variant, and
 * most of the picture still showing afterwards.
 */

import type { DesignValues } from '$lib/shared/presentations';
import type { ProjectEvent } from '$lib/shared/projects/events';
import { comparisonOutcome } from '$lib/shared/projects/events/visualization-presented';

import { settledFromEvidence } from './preference-model';

/** A change that hides something: a kind not shown, a type or pointer view of none, no listing. */
export function hides(variable: string, value: unknown): boolean {
  if (variable.endsWith('.shown')) return value === false;
  if (variable.startsWith('views.') || variable.startsWith('pointers.')) return value === 'none';
  return variable === 'listing.language' && value === 'none';
}

/** The most of the picture one press may hide, and the least that must stay. */
const hiddenAtMost = 0.5;

/**
 * The snippets a source defines, what each renders, what its root renders (in every layout), and
 * what each layout's root renders, the picture being the layout's a variant shows.
 */
export type PictureTree = {
  snippets: Map<string, string[]>;
  root: string[];
  layouts: Map<string, string[]>;
};

export function pictureTree(source: string): PictureTree {
  const markup = source.replace(/<script[\s\S]*?<\/script>/gu, '');
  const snippets = new Map<string, string[]>();
  const root: string[] = [];
  const open: string[] = [];
  const layouts = new Map<string, string[]>();
  let layout: string[] | undefined;
  const tokens =
    /\{#snippet\s+([A-Za-z_]\w*)|\{\/snippet\}|\{@render\s+([A-Za-z_]\w*)\s*\(|<Listing\b|\{#layout\s+([A-Za-z_]\w*)|\{\/layout\s*\}/gu;
  for (const match of markup.matchAll(tokens)) {
    if (match[3]) layouts.set(match[3], (layout = []));
    else if (match[0].startsWith('{/layout')) layout = undefined;
    else if (match[1]) {
      open.push(match[1]);
      if (!snippets.has(match[1])) snippets.set(match[1], []);
    } else if (match[0] === '{/snippet}') open.pop();
    else if (match[2]) {
      const parent = open.at(-1);
      if (parent) snippets.get(parent)!.push(match[2]);
      else {
        root.push(match[2]);
        layout?.push(match[2]);
      }
    } else if (open.length === 0) layout?.push('<Listing>');
    else snippets.get(open.at(-1)!)!.push('<Listing>');
  }
  return { snippets, root, layouts };
}

type Hidden = { snippets: Set<string>; types: Set<string>; listing: boolean };

/** How much of the picture shows: every node the root reaches, counted once per place it is drawn. */
function pictureSize(tree: PictureTree, variant: DesignValues, hidden: Hidden): number {
  const sizes = new Map<string, number>();
  const size = (name: string, path: readonly string[]): number => {
    if (name === '<Listing>') return hidden.listing ? 0 : 1;
    const body = tree.snippets.get(name);
    if (!body) {
      // A type rendered by name draws its view, or nothing when its view is none.
      if (hidden.types.has(name)) return 0;
      const view = variant[`views.${name}`] ?? variant[`pointers.${name}`];
      if (view === 'none') return 0;
      return typeof view === 'string' && tree.snippets.has(view) && !path.includes(view)
        ? size(view, path)
        : 1;
    }
    if (hidden.snippets.has(name) || path.includes(name)) return 0;
    if (sizes.has(name)) return sizes.get(name)!;
    const total = 1 + body.reduce((sum, child) => sum + size(child, [...path, name]), 0);
    sizes.set(name, total);
    return total;
  };
  // The layout shown, the first where the variant names none.
  const shown = tree.layouts.get(String(variant.layout)) ?? [...tree.layouts.values()][0] ?? [];
  return shown.reduce((sum, name) => sum + size(name, []), 0);
}

/** The snippet a kind's shown variable hides: the last kind in its path, before any place. */
function shownSnippet(variable: string): string {
  return variable.slice(0, -'.shown'.length).split('@')[0].split('.').at(-1) ?? variable;
}

function hiddenBy(changes: readonly [string, unknown][]): Hidden {
  const hidden: Hidden = { snippets: new Set(), types: new Set(), listing: false };
  for (const [variable, value] of changes) {
    if (!hides(variable, value)) continue;
    if (variable === 'listing.language') hidden.listing = true;
    else if (variable.endsWith('.shown')) hidden.snippets.add(shownSnippet(variable));
    // A place's own view (views.Int@value) hides one render; the type's, all of them.
    else if (!variable.includes('@'))
      hidden.types.add(
        variable
          .slice(variable.indexOf('.') + 1)
          .split('.')
          .at(-1)!
      );
  }
  return hidden;
}

/** The share of the picture these changes hide, from 0 to 1. */
export function hiddenShare(
  tree: PictureTree,
  variant: DesignValues,
  changes: readonly [string, unknown][]
): number {
  const empty: Hidden = { snippets: new Set(), types: new Set(), listing: false };
  const whole = pictureSize(tree, variant, empty);
  if (whole === 0) return 0;
  return 1 - pictureSize(tree, variant, hiddenBy(changes)) / whole;
}

export type GuardContext = {
  tree: PictureTree;
  /** The variant the choices start from. */
  base: DesignValues;
  /** Values earlier preferences or the assistant's vary decisions settled. */
  settled: DesignValues;
};

/** Whether one change may be made on its own: not a settled value, not hiding too much. */
export function allowedChange(context: GuardContext, variable: string, value: unknown): boolean {
  if (variable in context.settled && context.settled[variable] !== value) return false;
  if (!hides(variable, value)) return true;
  // Nor the nodes a layout writes beside its parts, which are its root's.
  const snippet = variable.endsWith('.shown') ? shownSnippet(variable) : undefined;
  if (snippet && (context.tree.root.includes(snippet) || context.tree.layouts.has(snippet)))
    return false;
  return hiddenShare(context.tree, context.base, [[variable, value]]) < hiddenAtMost;
}

/**
 * A choice held to the limits: changes to settled values and hides that are not allowed are
 * dropped, then all but its first hide, and every hide when together they leave too little showing.
 */
export function guardedChoice<Choice extends { chosen: DesignValues }>(
  context: GuardContext,
  choice: Choice
): Choice {
  let hidden = false;
  const kept = Object.entries(choice.chosen).filter(([variable, value]) => {
    if (!allowedChange(context, variable, value)) return false;
    if (!hides(variable, value)) return true;
    if (hidden) return false;
    hidden = true;
    return true;
  });
  const safe =
    hiddenShare(context.tree, context.base, kept) < hiddenAtMost
      ? kept
      : kept.filter(([variable, value]) => !hides(variable, value));
  return { ...choice, chosen: Object.fromEntries(safe) };
}

/**
 * The values a project has settled, by the preference model (preference-model.ts): a choice one
 * option of which is very likely best over at least two answers, a vary decision's value no answer
 * has since gone against, or, where either is fine was the latest answer, the value showing.
 */
export function settledValues(events: readonly ProjectEvent[]): DesignValues {
  return settledFromEvidence(events);
}

/**
 * What one answer to a comparison did: the values it newly settled, and the pair it answered, as
 * the two sides' values where they differed.
 */
export type Answer = { eventId: number; settled: DesignValues; pair: [DesignValues, DesignValues] };

/** The answers recorded after an event, each but decide later, which answers nothing. */
export function answersAfter(events: readonly ProjectEvent[], after: number): Answer[] {
  const variants = new Map<string, DesignValues>();
  const answers: Answer[] = [];
  for (const event of events) {
    if (
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1' &&
      event.payload.presentation.variant
    )
      variants.set(event.payload.presentation.presentationId, event.payload.presentation.variant);
    if (
      event.type !== 'visualization.preference-recorded' ||
      event.id <= after ||
      comparisonOutcome(event.payload) === 'skip'
    )
      continue;
    const [left, right] = event.payload.presentations.map((id) => variants.get(id) ?? {});
    const before = settledValues(events.filter(({ id }) => id < event.id));
    const now = settledValues(events.filter(({ id }) => id <= event.id));
    answers.push({
      eventId: event.id,
      settled: Object.fromEntries(
        Object.entries(now).filter(([variable, value]) => before[variable] !== value)
      ),
      pair: askedPair(left, right)
    });
  }
  return answers;
}

/** The variables two variants give different values. */
export function differing(left: DesignValues, right: DesignValues): string[] {
  return Object.keys({ ...left, ...right }).filter(
    (variable) => left[variable] !== right[variable]
  );
}

/** What a pair asks: its two sides' values where they differ. */
export function askedPair(left: DesignValues, right: DesignValues): [DesignValues, DesignValues] {
  const variables = differing(left, right);
  const side = (values: DesignValues) =>
    Object.fromEntries(variables.map((variable) => [variable, values[variable]])) as DesignValues;
  return [side(left), side(right)];
}

/** A pair's two sides as one key, whichever side is first. */
function pairKey([left, right]: readonly [DesignValues, DesignValues]): string {
  const side = (values: DesignValues) =>
    JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  return [side(left), side(right)].sort().join('|');
}

/**
 * Whether an answer makes a waiting comparison, asking these values of its two sides where they
 * differ, moot: it asks the pair just answered, or about a variable the answer settled, or names in
 * its path something a value it settled hides (a kind not shown, a type's view of none, no listing).
 */
export function mootComparison(
  answer: Answer,
  asked: readonly [DesignValues, DesignValues]
): boolean {
  if (pairKey(asked) === pairKey(answer.pair)) return true;
  const variables = differing(...asked);
  if (variables.some((variable) => Object.hasOwn(answer.settled, variable))) return true;
  const hidden = hiddenBy(Object.entries(answer.settled));
  const names = new Set([...hidden.snippets, ...hidden.types]);
  return variables.some(
    (variable) =>
      (hidden.listing && variable.startsWith('listing.')) ||
      variable
        .split('@')[0]
        .split('.')
        .some((part) => names.has(part))
  );
}
