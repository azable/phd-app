/**
 * One developer-registered catalogue of visualization modes and their owned assistants. Titles are
 * shown in study UI, so they name no mode and say nothing of how it works, keeping the study blind.
 */

import { sverlinStarter } from './sverlin/contract';
import { htmlStarter } from './html/contract';
import { htmlJsStarter } from './html-js/contract';

export const modeCatalog = {
  sverlin: {
    assistantId: 'sverlin-assistant',
    authoring: 'source',
    scriptedPlayback: true,
    title: 'System A',
    starter: sverlinStarter
  },
  html: {
    assistantId: 'html-assistant',
    authoring: 'candidates',
    scriptedPlayback: false,
    title: 'System B',
    starter: htmlStarter
  },
  'html-js': {
    assistantId: 'html-js-assistant',
    authoring: 'candidates',
    scriptedPlayback: true,
    title: 'System C',
    starter: htmlJsStarter
  }
} as const;
