/**
 * The parts of the project workspace a participant can be pointed at, by the interface tour and by
 * the assistant's replies (an `interface-ref` segment). Names and descriptions are
 * participant-facing: they never name a system or say how it works, keeping the study blind (see
 * `modeCatalog`).
 */

import type { MessageContentSegment } from './projects/events/message-content';
import type { VisualizationMode } from './presentations';

export const interfacePartIds = [
  'timeline',
  'version-pill',
  'stage',
  'step-controls',
  'answer-buttons',
  'comparison-card',
  'choices-panel',
  'export',
  'source-panel',
  'message-box',
  'return-to-present',
  'help'
] as const;

export type InterfacePartId = (typeof interfacePartIds)[number];

/** How a part is found on the page: the match of `selector` (the last when `last`), `up` levels up. */
export type InterfacePartLocator = { selector: string; last?: boolean; up?: number };

export type InterfacePart = {
  id: InterfacePartId;
  name: string;
  /** What it does and how to use it, for each system that has the part. */
  descriptions: Partial<Record<VisualizationMode, string>>;
  locator: InterfacePartLocator;
};

const everySystem = (description: string): Record<VisualizationMode, string> => ({
  sverlin: description,
  html: description
});

const singleVersionSystems = (description: string) => ({
  html: description
});

export const interfaceParts: readonly InterfacePart[] = [
  {
    id: 'timeline',
    name: 'Timeline',
    descriptions: {
      sverlin:
        'Your conversation with the assistant, newest at the bottom. Its replies, the versions it makes and the comparisons it asks you about appear here.',
      ...singleVersionSystems(
        'Your conversation with the assistant, newest at the bottom. Its replies and the versions it makes appear here.'
      )
    },
    locator: { selector: 'section[aria-label="Project Timeline"]' }
  },
  {
    id: 'version-pill',
    name: 'Version tags',
    descriptions: {
      sverlin:
        'Each version of the visualization appears in the timeline as a small tag. Select one to show it on the stage; hover over it to add it to your message or see its code.',
      ...singleVersionSystems(
        'Each version of the visualization appears in the timeline as a small tag. Select one to show it on the stage; hover over it to add it to your message.'
      )
    },
    locator: { selector: 'button[aria-label^="View "][aria-pressed]', last: true }
  },
  {
    id: 'stage',
    name: 'Stage',
    descriptions: {
      sverlin:
        'Shows the visualization. Select elements in it, then Reference, to point at them in your message.',
      ...singleVersionSystems(
        'Shows the visualization. Select a version tag in the timeline to show that version here.'
      )
    },
    locator: { selector: 'section[aria-label="Visualization presentations"]' }
  },
  {
    id: 'step-controls',
    name: 'Step controls',
    descriptions: everySystem(
      'Previous and Next move through the visualization one step at a time; between them is the step you are on.'
    ),
    locator: { selector: 'button[aria-label="Previous visualization step"]', up: 1 }
  },
  {
    id: 'answer-buttons',
    name: 'Answer buttons',
    descriptions: {
      sverlin:
        'When the assistant shows two versions, top and bottom, say which you prefer: Top, Bottom, Either, or Unsure if you would rather not decide. Choose again to change your answer.'
    },
    locator: { selector: '[role="group"][aria-label="Your answer"]' }
  },
  {
    id: 'comparison-card',
    name: 'Comparison card',
    descriptions: {
      sverlin:
        'Each comparison stays in the timeline as a card. Select it to show that pair on the stage again and answer or change your answer.'
    },
    locator: { selector: 'button[title="Show this comparison"]', last: true, up: 2 }
  },
  {
    id: 'choices-panel',
    name: 'Choices',
    descriptions: {
      sverlin:
        'Lists what differs between the two versions on the stage, such as a colour or a spacing. Pick one version to see all of its choices.'
    },
    locator: { selector: '[role="group"][aria-label="Choices shown"]', up: 1 }
  },
  {
    id: 'export',
    name: 'Export',
    descriptions: {
      sverlin: 'At the top left of the stage, Export saves the visualization shown as a file.'
    },
    locator: { selector: 'button[aria-label="Export this visualization"]' }
  },
  {
    id: 'source-panel',
    name: 'Source',
    descriptions: everySystem(
      'The code the visualization is made from. Expand it to read it, or choose Edit to change it yourself, then Save & build.'
    ),
    locator: { selector: 'section[aria-label="Project artifact"]' }
  },
  {
    id: 'message-box',
    name: 'Message box',
    descriptions: {
      sverlin:
        'Write to the assistant here: Enter sends, Shift+Enter starts a new line. Elements and versions you reference appear in your message.',
      ...singleVersionSystems(
        'Write to the assistant here: Enter sends, Shift+Enter starts a new line. Versions you add appear in your message.'
      )
    },
    locator: { selector: '[role="textbox"][aria-label="Project feedback"]' }
  },
  {
    id: 'return-to-present',
    name: 'Return to present',
    descriptions: everySystem(
      'You are looking at an earlier moment of the project, which cannot be changed. Return to present to carry on working.'
    ),
    locator: { selector: '[aria-label="Return to present"]' }
  },
  {
    id: 'help',
    name: 'Help',
    descriptions: everySystem('Shows this introduction to the interface again.'),
    locator: { selector: '[data-interface-part="help"]' }
  }
];

const byId = new Map(interfaceParts.map((part) => [part.id, part]));

export function interfacePart(id: InterfacePartId): InterfacePart {
  return byId.get(id)!;
}

/** The parts a system's interface has, in plain words, for the assistant's context. */
export function interfacePartsFor(
  mode: VisualizationMode
): { id: InterfacePartId; name: string; description: string }[] {
  return interfaceParts.flatMap(({ id, name, descriptions }) => {
    const description = descriptions[mode];
    return description ? [{ id, name, description }] : [];
  });
}

/**
 * A reply's reference to an interface part, as the system shows it: kept where its interface has
 * the part, otherwise the part's name as plain text.
 */
export function interfaceReferenceFor(
  part: InterfacePartId,
  mode: VisualizationMode
): MessageContentSegment {
  const { name, descriptions } = interfacePart(part);
  return descriptions[mode] ? { type: 'interface-ref', part } : { type: 'markdown', text: name };
}
