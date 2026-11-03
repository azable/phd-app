import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { RenderablePresentation } from '$lib/shared/presentations';
import PresentationViewport from './PresentationViewport.svelte';

const recorded = (text: string, mediaType: string) => ({ text, sha256: 'a'.repeat(64), mediaType });

describe('mode-owned presentation playback', () => {
  it('isolates a seeded Svelte presentation in an opaque-origin script frame', () => {
    const presentation: RenderablePresentation = {
      presentationId: '12345678-1234-4123-8123-123456789ac1',
      format: 'browser-bundle-v1',
      mode: 'sverlin',
      seed: 7,
      stepSignature: 'steps',
      labels: ['Start', 'Result'],
      source: recorded('<h1>Component</h1>', 'text/x-svelte'),
      html: recorded('', 'text/html'),
      javascript: recorded('document.body.textContent = "Ready";', 'text/javascript')
    };
    const { body } = render(PresentationViewport, {
      props: { presentation, step: 1, label: 'Svelte view' }
    });
    expect(body).toContain('sandbox="allow-scripts"');
    expect(body).toContain('window.__sverlinStep=1');
    expect(body).toContain('window.__sverlinSeed=7');
    expect(body).not.toContain('allow-same-origin');
  });

  it('plays sanitized static frames with scripts disabled', () => {
    const manifest = JSON.stringify({
      format: 'sverlin-html-frames',
      version: 1,
      frames: [{ label: 'Start', html: '<main>Static</main>' }]
    });
    const presentation: RenderablePresentation = {
      presentationId: '12345678-1234-4123-8123-123456789ac2',
      format: 'html-frames-v1',
      stepSignature: 'steps',
      authored: recorded(manifest, 'application/json'),
      rendered: recorded(manifest, 'application/json')
    };
    const { body } = render(PresentationViewport, {
      props: { presentation, step: 0, label: 'Static view' }
    });
    expect(body).toContain('sandbox=""');
    expect(body).toContain("script-src 'none'");
    expect(body).toContain('Static');
  });
});
