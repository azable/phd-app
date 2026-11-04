import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';

import { fontList, fontValues } from '../library/fonts';
import type { SceneText } from '../library';
import { sceneMessageSchema, type SverlinScene } from '../scene';
import { faceFiles, fallbackRuns, renderPdf } from './pdf';

/** What the PDFs drawn here were asked to draw, by method, in order. */
const drawn = vi.hoisted(() => [] as { method: string; args: unknown[] }[]);
vi.mock('jspdf', async (original) => {
  const module = await original<typeof import('jspdf')>();
  const recorded = ['roundedRect', 'rect', 'line', 'text', 'clip', 'setFontSize', 'setFillColor'];
  class RecordingPdf extends module.jsPDF {
    constructor(...args: ConstructorParameters<typeof module.jsPDF>) {
      super(...args);
      const methods = this as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const method of recorded) {
        const own = methods[method].bind(this);
        methods[method] = (...args: unknown[]) => {
          drawn.push({ method, args });
          return own(...args);
        };
      }
    }
  }
  return { ...module, jsPDF: RecordingPdf };
});

const fontsDirectory = join(import.meta.dirname, '../fonts');
const dejaVuDirectory = join(
  dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')),
  'ttf'
);

async function readFont(file: string): Promise<ArrayBuffer> {
  const directory = file.startsWith('DejaVu') ? dejaVuDirectory : fontsDirectory;
  const data = await readFile(join(directory, `${file}.ttf`));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

describe('faceFiles', () => {
  it('names the embedded families neutrally, after no system', () => {
    for (const value of fontValues) expect(fontList(value)).toMatch(/^'Vis \w+', 'Vis Symbols', /u);
  });

  it('takes the embedded faces a font list starts with, at the weight drawn, then DejaVu', () => {
    expect(faceFiles(fontList('serif'), 400)).toEqual([
      'serif-400',
      'symbols-400',
      'icons-400',
      'DejaVuSerif'
    ]);
    expect(faceFiles(fontList('casual'), 700)).toEqual([
      'casual-700',
      'symbols-700',
      'icons-700',
      'DejaVuSans-Bold'
    ]);
    expect(faceFiles(`"Vis Mono", "Vis Symbols", monospace`, 600)).toEqual([
      'mono-700',
      'symbols-700',
      'DejaVuSansMono-Bold'
    ]);
  });

  it('leaves a font list that starts with a machine font to DejaVu', () => {
    expect(faceFiles('Georgia, serif', 400)).toEqual(['DejaVuSerif']);
  });
});

describe('fallbackRuns', () => {
  const faces = { text: new Set('ab '), symbols: new Set('∅'), last: new Set('Ж') };
  const has = (face: keyof typeof faces, character: string) => faces[face].has(character);

  it('draws each character in the first face that has it, keeping runs together', () => {
    expect(fallbackRuns('ab ∅∅ Жa', ['text', 'symbols', 'last'] as const, has)).toEqual([
      { face: 'text', text: 'ab ' },
      { face: 'symbols', text: '∅∅' },
      { face: 'text', text: ' ' },
      { face: 'last', text: 'Ж' },
      { face: 'text', text: 'a' }
    ]);
  });

  it('leaves a character no face has in the run it is in', () => {
    expect(fallbackRuns('a☃∅☃', ['text', 'symbols'] as const, has)).toEqual([
      { face: 'text', text: 'a☃' },
      { face: 'symbols', text: '∅☃' }
    ]);
  });
});

describe('renderPdf', () => {
  const run = (text: string, font: string, fontWeight: number): SceneText => ({
    text,
    box: { x: 10, y: 10, width: 100, height: 20 },
    color: 'black',
    font,
    fontSize: 16,
    fontWeight
  });
  const scene: SverlinScene = {
    format: 'sverlin-scene-v1',
    presentationId: '00000000-0000-0000-0000-000000000000',
    seed: 1,
    frame: { width: 200, height: 100, background: 'white' },
    steps: [
      {
        label: 'Start',
        links: [],
        nodes: [
          {
            id: 'a',
            box: { x: 0, y: 0, width: 120, height: 40 },
            look: { color: 'black', font: fontList('sans'), fontSize: 16, fontWeight: 700 },
            runs: [run('Tower ∅ Ж', fontList('sans'), 700), run('x = 1', fontList('mono'), 400)]
          }
        ]
      }
    ]
  };

  it('embeds the faces the page drew in, the fallback face and DejaVu only where needed', async () => {
    const requested: string[] = [];
    const blob = await renderPdf(scene, {
      async font(file) {
        requested.push(file);
        const directory = file.startsWith('DejaVu') ? dejaVuDirectory : fontsDirectory;
        const data = await readFile(join(directory, `${file}.ttf`));
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
      colour: () => [0, 0, 0, 1]
    });
    expect(requested.sort()).toEqual(['DejaVuSans-Bold', 'mono-400', 'sans-700', 'symbols-700']);
    // jsPDF lists its 14 standard fonts in every file, embedding none of them.
    const embedded = new Set(
      [...(await blob.text()).matchAll(/\/BaseFont\s*\/([\w-]+)/gu)]
        .map(([, name]) => name)
        .filter((name) => !/^(Helvetica|Courier|Times|Symbol$|ZapfDingbats)/u.test(name))
    );
    expect([...embedded].sort()).toEqual([
      'DejaVuSans-Bold',
      'Mono-Regular',
      'Sans-Bold',
      'Symbols-Bold'
    ]);
  });
});

describe('renderPdf drawing a node’s style', () => {
  // Frame pixels in points.
  const pt = (pixels: number) => pixels * 0.75;
  const scene: SverlinScene = {
    format: 'sverlin-scene-v1',
    presentationId: '00000000-0000-0000-0000-000000000000',
    seed: 1,
    frame: { width: 200, height: 100, background: 'white' },
    steps: [
      {
        label: 'Start',
        links: [],
        nodes: [
          {
            id: 'a',
            box: { x: 10, y: 10, width: 80, height: 40 },
            look: {
              fill: 'white',
              stroke: 'red',
              strokeWidth: 2,
              radius: 8,
              color: 'black',
              font: fontList('sans'),
              fontSize: 16,
              fontWeight: 400,
              shadow: 'hard',
              glow: 'red',
              fillStyle: 'hatched'
            },
            runs: [
              {
                text: 'Swap',
                box: { x: 20, y: 20, width: 60, height: 20 },
                color: 'black',
                font: fontList('sans'),
                fontSize: 16,
                fontWeight: 400,
                decoration: 'underline',
                case: 'small-caps'
              }
            ]
          }
        ]
      }
    ]
  };

  it('is scene data the app accepts', () => {
    const { label, ...step } = scene.steps[0];
    expect(label).toBe('Start');
    const message = { type: 'sverlin:scene', request: 'r', frame: scene.frame, steps: [step] };
    expect(v.is(sceneMessageSchema, message)).toBe(true);
    const node = step.nodes[0];
    const unknown = { ...node, look: { ...node.look, shadow: 'deep' } };
    expect(v.is(sceneMessageSchema, { ...message, steps: [{ ...step, nodes: [unknown] }] })).toBe(
      false
    );
  });

  it('draws the glow and shadow behind the box, the hatch in it, and the text’s case and line', async () => {
    drawn.length = 0;
    await renderPdf(scene, {
      font: readFont,
      colour: (css) => (css === 'red' ? [255, 0, 0, 1] : [0, 0, 0, 1])
    });
    const calls = (method: string) =>
      drawn.filter((call) => call.method === method).map(({ args }) => args);
    const shapes = calls('roundedRect').filter((args) => args[6] === 'F');
    // The glow reaches 6 pixels round the box, then the hard shadow 3 down and right, in the
    // stroke's colour, then the box's own fill.
    expect(shapes.slice(0, 3).map((args) => args.slice(0, 2))).toEqual([
      [pt(4), pt(4)],
      [pt(13), pt(13)],
      [pt(10), pt(10)]
    ]);
    expect(calls('setFillColor')).toContainEqual([255, 0, 0]);
    // The hatch is kept inside the box, as lines.
    expect(calls('clip')).toHaveLength(1);
    expect(calls('line').filter(([, y1, , y2]) => y1 !== y2).length).toBeGreaterThan(5);
    // Small capitals at 0.7 of the size, and a line under the text.
    expect(calls('text').map(([text]) => text)).toEqual(['S', 'WAP']);
    expect(calls('setFontSize')).toContainEqual([pt(16 * 0.7)]);
    expect(calls('line').filter(([, y1, , y2]) => y1 === y2)).toHaveLength(1);
  });
});
