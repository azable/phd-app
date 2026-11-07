/**
 * Developer-owned project starters: each a source and the design its versions start from where no
 * version has been built yet, a template's name (see modes/sverlin/templates).
 */

import type { ProjectCreation, ProjectTemplateSummary } from '$lib/shared/projects/creation';
import { linearSearchSource, sverlinStarter } from '$lib/modes/sverlin/contract';

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
    design: { template: '$starter' }
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
  design: Readonly<Record<string, string>>;
} {
  const template = getProjectTemplate(creation.templateId);
  if (creation.mode && creation.mode !== 'sverlin' && creation.templateId !== 'blank') {
    throw new Error('This starter is available only for the Svelte-backed mode.');
  }
  return { source: template.source, title: template.title, design: template.design };
}

export class UnknownProjectTemplateError extends Error {
  constructor(templateId: string) {
    super(`Unknown project template: ${templateId}.`);
    this.name = 'UnknownProjectTemplateError';
  }
}
