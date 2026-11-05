/**
 * The variants a Sverlin source's further presentations are built with: the values the assistant
 * gives, and the rest drawn at random, every choice held to the limits on what may be hidden
 * (variant-guard.ts).
 */

import type { AiDesign, SourceBuildFacts } from '$lib/server/chat-bots/project-context';
import type { BuildRequest } from '$lib/modes/server';
import type { BrowserBundlePresentation, DesignValues } from '$lib/shared/presentations';
import type { ProjectDocument } from '$lib/shared/projects/model';

import { guardedChoice, pictureTree } from './variant-guard';

/**
 * Where a design space is read from: a build's bundle, or a presentation of the source with its
 * build's runs and structures where they are known.
 */
export type DesignSource = Pick<
  BrowserBundlePresentation,
  'variant' | 'origins' | 'views' | 'pointers' | 'listings'
> &
  SourceBuildFacts;

export type ChooserRequest = {
  document: ProjectDocument;
  source: string;
  summary?: string;
  count: number;
  design: DesignSource;
  /** Variants of this source already shown, newest first, each as the values it differs in. */
  seen: DesignValues[];
  /** Values earlier preferences or the assistant's vary decisions settled, which no draw changes. */
  settled: DesignValues;
  operationId: string;
  attempt: number;
};

/** The values one variant sets, and the variables it draws afresh at random. */
export type VariantChoice = { chosen: DesignValues; randomise?: true | readonly string[] };

export type VariantChooser = {
  id: 'random';
  /** One choice per requested variant; no choices when choosing failed. */
  choose(
    request: ChooserRequest
  ): Promise<{ document: ProjectDocument; choices?: VariantChoice[] }>;
};

/**
 * The random draw: more variants of a source draw every variable afresh, keeping what
 * randomised() keeps.
 */
export const randomChooser: VariantChooser = {
  id: 'random',
  async choose(request) {
    const choice: VariantChoice = { chosen: {}, randomise: true };
    return {
      document: request.document,
      choices: Array.from({ length: request.count }, () => choice)
    };
  }
};

/**
 * Ask a chooser, falling back to the random draw when it fails, and hold every choice to the
 * limits on what may be hidden (variant-guard.ts).
 */
export async function chooseVariants(
  chooser: VariantChooser,
  request: ChooserRequest
): Promise<{ document: ProjectDocument; choices: VariantChoice[]; chooser: 'random' }> {
  const result = await chooser.choose(request);
  const context = {
    tree: pictureTree(request.source),
    base: request.design.variant ?? {},
    settled: request.settled
  };
  if (result.choices)
    return {
      document: result.document,
      choices: result.choices.map((choice) => guardedChoice(context, choice)),
      chooser: chooser.id
    };
  const fallback = await randomChooser.choose({ ...request, document: result.document });
  return { document: fallback.document, choices: fallback.choices ?? [], chooser: 'random' };
}

/** A variable's options in a design, or undefined where it has none. */
export function offeredOptions(
  design: AiDesign,
  key: string
): AiDesign['options'][string] | undefined {
  const found = design.variables.find(({ variable }) => variable === key);
  if (!found) return undefined;
  return typeof found.options === 'string' ? design.options[found.options] : found.options;
}

/**
 * Build requests for the chosen variants, from a base variant. A value the space does not offer is
 * left out, and a variant no choice covers is drawn at random, so a pair still has two.
 */
export function chosenRequests(
  seeds: readonly number[],
  design: AiDesign,
  base: DesignValues | undefined,
  choices: readonly VariantChoice[]
): BuildRequest[] {
  return seeds.map((seed, index) => {
    const choice = choices[index];
    const chosen = Object.fromEntries(
      Object.entries(choice?.chosen ?? {}).filter(([key, value]) =>
        offeredOptions(design, key)?.includes(value)
      )
    );
    const randomise =
      choice?.randomise === true
        ? (true as const)
        : (choice?.randomise ?? []).filter((key) => offeredOptions(design, key));
    return {
      seed,
      variant: {
        ...(base ? { base } : {}),
        chosen,
        ...(!choice || randomise === true
          ? { randomise: true as const }
          : randomise.length
            ? { randomise }
            : {})
      }
    };
  });
}

/** Each shown variant as the values it differs in from a base, dropping those that differ in none. */
export function differences(
  variants: readonly DesignValues[],
  base: DesignValues | undefined
): DesignValues[] {
  return variants
    .map((variant) =>
      Object.fromEntries(Object.entries(variant).filter(([key, value]) => base?.[key] !== value))
    )
    .filter((changed) => Object.keys(changed).length > 0);
}
