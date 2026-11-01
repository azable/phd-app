import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fontList } from '../library/fonts';
import type { SceneText } from '../library';
import type { SverlinScene } from '../scene';
import { faceFiles, fallbackRuns, renderPdf } from './pdf';

const fontsDirectory = join(import.meta.dirname, '../fonts');
const dejaVuDirectory = join(
  dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')),
  'ttf'
);

describe('faceFiles', () => {
  it('takes the embedded faces a font list starts with, at the weight drawn, then DejaVu', () => {
    expect(faceFiles(fontList('serif'), 400)).toEqual(['serif-400', 'symbols-400', 'DejaVuSerif']);
    expect(faceFiles(fontList('casual'), 700)).toEqual([
      'casual-700',
      'symbols-700',
      'DejaVuSans-Bold'
    ]);
    expect(faceFiles(`"Sverlin Mono", "Sverlin Symbols", monospace`, 600)).toEqual([
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
        .filter((name) => /^(Sverlin|DejaVu)/u.test(name))
    );
    expect([...embedded].sort()).toEqual([
      'DejaVuSans-Bold',
      'SverlinMono-Regular',
      'SverlinSans-Bold',
      'SverlinSymbols-Bold'
    ]);
  });
});
