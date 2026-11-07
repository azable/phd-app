/**
 * Developer-owned project starters: each a source and the design its versions start from where no
 * version has been built yet, nested as the design reads: the template it copies (see
 * modes/sverlin/templates) and the style each of its kinds links.
 */

import type { ProjectCreation, ProjectTemplateSummary } from '$lib/shared/projects/creation';
import type { DesignValues } from '$lib/shared/presentations';
import { linearSearchSource, sverlinStarter } from '$lib/modes/sverlin/contract';
import { designKeys } from '$lib/modes/server';

const templates = [
  {
    id: 'blank',
    title: 'Blank project',
    summary: 'Start with a small self-contained visualization component.',
    features: ['AI-assisted editing'],
    source: sverlinStarter.source,
    design: { template: '$starter' }
  },
  {
    id: 'linear-search',
    title: 'Linear search',
    summary: 'A stepped, seeded array search in one Svelte component.',
    features: ['steps', 'seeded input', 'Svelte'],
    source: linearSearchSource,
    design: {
      template: '$starter',
      IntCell: { '...': '$cell' },
      Checking: { Number: { '...': '$cell' } },
      Result: { Number: { '...': '$cell' } }
    }
  }
] as const;

/** Metadata offered to administrator project creation. */
export function listProjectTemplates(): ProjectTemplateSummary[] {
  return templates.map(({ source: _source, design: _design, features, ...template }) => ({
    ...template,
    features: [...features]
  }));
}

/** Return a known immutable starter or a client-safe validation error. */
export function getProjectTemplate(templateId: string): (typeof templates)[number] {
  const template = templates.find(({ id }) => id === templateId);
  if (!template) throw new UnknownProjectTemplateError(templateId);
  return template;
}

export function resolveProjectTemplate(creation: ProjectCreation): {
  source: string;
  title: string;
  design: DesignValues;
} {
  const template = getProjectTemplate(creation.templateId);
  if (creation.mode && creation.mode !== 'sverlin' && creation.templateId !== 'blank') {
    throw new Error('This starter is available only for the Svelte-backed mode.');
  }
  return {
    source: template.source,
    title: template.title,
    design: designKeys.flat(template.design) as DesignValues
  };
}

export class UnknownProjectTemplateError extends Error {
  constructor(templateId: string) {
    super(`Unknown project template: ${templateId}.`);
    this.name = 'UnknownProjectTemplateError';
  }
}
