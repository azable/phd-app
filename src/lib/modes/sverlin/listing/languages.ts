import type { Definition } from './definition';
import { pseudocode } from './pseudocode';
import { python } from './python';

/** The library's listing languages, by the name a variant chooses them by. */
export const listingLanguages: Readonly<Record<string, Definition>> = { python, pseudocode };
