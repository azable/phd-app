/** The choosers a Sverlin project's variants can come from: the model, the Decisions API, or a random draw. */
export const chooserIds = ['model', 'decisions', 'random'] as const;
export type ChooserId = (typeof chooserIds)[number];
