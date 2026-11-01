/**
 * How a presentation loaded in a viewer's browser (see presentation-load-timing.ts), for debugging
 * from exported data. Inert: it changes no project state, is shown only in developer view, and is
 * left out of the assistant's context.
 */

import * as v from 'valibot';

import { presentationLoadTimingSchema } from '$lib/shared/presentation-load-timing';

import { eventEnvelope } from './values';

export const visualizationLoadedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.loaded'),
  payload: presentationLoadTimingSchema
});
