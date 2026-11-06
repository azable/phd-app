import { expect, it } from 'vitest';

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import { UnavailableScenesError } from '../../server';
import { prepareSvelteComponent } from '../compile.server';
import { bundlePresentation } from '../testing/scenes';
import search from '../fixtures/search-places.sverlin?raw';
import { exportFile } from './export.server';

async function version(presentationId: string, javascript?: string) {
  const built = await bundlePresentation(prepareSvelteComponent(search), 1);
  return {
    presentationId,
    seed: 1,
    source: { text: search },
    javascript: { text: javascript ?? built.javascript },
    labels: built.labels
  } as unknown as BrowserBundlePresentation;
}

it(
  'exports a version as a PDF made on the server, a page per step',
  { timeout: 60_000 },
  async () => {
    const presentation = await version('11111111-1111-4111-8111-111111111111');
    const file = await exportFile(presentation, 'pdf');
    expect(file?.name).toBe('presentation-11111111-seed-1.pdf');
    expect(file?.contentType).toBe('application/pdf');
    const pdf = Buffer.from(file!.body);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(
      presentation.labels.length
    );
  }
);

it('exports its scene data, each step named by its label', { timeout: 60_000 }, async () => {
  const presentation = await version('22222222-2222-4222-8222-222222222222');
  const file = await exportFile(presentation, 'scene');
  expect(file?.contentType).toBe('application/json');
  const scene = JSON.parse(new TextDecoder().decode(file!.body));
  expect(scene.steps.map(({ label }: { label: string }) => label)).toEqual(presentation.labels);
  expect(await exportFile(presentation, 'gif')).toBeUndefined();
});

it('makes none of a version an older app built', { timeout: 60_000 }, async () => {
  const presentation = await version('33333333-3333-4333-8333-333333333333', 'older page code');
  await expect(exportFile(presentation, 'pdf')).rejects.toBeInstanceOf(UnavailableScenesError);
});
