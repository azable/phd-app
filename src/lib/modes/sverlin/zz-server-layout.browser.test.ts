// Spike harness (not for main): every presentation in the page, with system or embedded fonts;
// keeps each step's markup and page boxes, every text width the page measured, scenes and timing.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';

const S =
  '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
const fonts = process.env.SPIKE_FONTS ?? 'system';
const only = process.env.SPIKE_ONLY;
const dpr = Number(process.env.SPIKE_DPR ?? 1);
const out = `${S}/s4/page-${fonts}${dpr === 1 ? '' : `-dpr${dpr}`}`;
const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1' && process.env.SPIKE === '1';

const faces: [family: string, weight: number, file: string][] = [
  ['Sverlin Sans', 400, '@fontsource/inter/files/inter-latin-400-normal.woff2'],
  ['Sverlin Sans', 700, '@fontsource/inter/files/inter-latin-700-normal.woff2'],
  ['Sverlin Serif', 400, '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2'],
  ['Sverlin Serif', 700, '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2'],
  ['Sverlin Mono', 400, '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'],
  ['Sverlin Mono', 700, '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2']
];
const dejavuFaces: typeof faces = faces.map(([family, weight]) => [
  family,
  weight,
  `${S}/s4/subset/${family.split(' ')[1].toLowerCase()}-${weight}.woff2`
]);
const faceCss = (fonts === 'dejavu' ? dejavuFaces : faces)
  .map(
    ([family, weight, file]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${readFileSync(file.startsWith('/') ? file : `node_modules/${file}`).toString('base64')}) format('woff2')}`
  )
  .join('');

type Case = { name: string; source: string; request: Record<string, unknown>; seed: number };
function cases(): Case[] {
  const list: Case[] = [];
  list.push({
    name: 'dijkstra-demo',
    source: readFileSync(`${S}/dijkstra.svelte`, 'utf8'),
    request: { chosen: JSON.parse(readFileSync(`${S}/owl-variant.json`, 'utf8')) },
    seed: 1
  });
  list.push({
    name: 'bfs-demo',
    source: readFileSync(`${S}/demo2/v5.svelte`, 'utf8'),
    request: { chosen: JSON.parse(readFileSync(`${S}/bfs-variant.json`, 'utf8')) },
    seed: 1
  });
  const dir = 'src/lib/modes/sverlin/fixtures';
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sverlin'))
    .sort()) {
    const source = readFileSync(`${dir}/${file}`, 'utf8');
    const name = file.replace('.sverlin', '');
    list.push({ name, source, request: {}, seed: 1 });
    for (const seed of [2, 3])
      list.push({ name: `${name}~${seed}`, source, request: { randomise: true }, seed });
  }
  return only ? list.filter((c) => new RegExp(only).test(c.name)) : list;
}

it.skipIf(!enabled)('collects page layouts', { timeout: 3_600_000 }, async () => {
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  const browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
  mkdirSync(out, { recursive: true });
  const lines: string[] = [];
  for (const c of cases()) {
    const { javascript } = await bundlePresentation(
      prepareSvelteComponent(c.source),
      c.seed,
      c.request as never
    );
    let inner = sandboxDocument('', javascript, 0, 1);
    if (fonts !== 'system') inner = inner.replace('</head>', `<style>${faceCss}</style></head>`);
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: dpr
    });
    const html = `<!doctype html><html><head><style>html,body{margin:0}iframe{border:0;width:1200px;height:800px}</style><script>window.__timing=[];addEventListener("message",function(e){var m=e.data;if(!m)return;if(m.type==="sverlin:timing")window.__timing.push(m);if(m.type==="sverlin:scene")window.__scene=m;});</script></head><body><iframe id="f" sandbox="allow-scripts"></iframe></body></html>`;
    await page.setContent(html);
    const start = Date.now();
    await page.evaluate((s) => {
      (document.getElementById('f') as HTMLIFrameElement).srcdoc = s;
    }, inner);
    await page.waitForFunction(
      () => (window as never as { __timing: { phase: string }[] }).__timing.some((m) => m.phase === 'ready'),
      null,
      { timeout: 600_000, polling: 20 }
    );
    const wall = Date.now() - start;
    const timing = await page.evaluate(() => (window as never as { __timing: unknown[] }).__timing);
    await page.evaluate(() =>
      (document.getElementById('f') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'sverlin:describe', request: 'spike', check: true, dump: true },
        '*'
      )
    );
    await page.waitForFunction(() => (window as never as { __scene?: unknown }).__scene, null, {
      timeout: 900_000
    });
    const scene = await page.evaluate(() => (window as never as { __scene: unknown }).__scene);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    const measured = await frame.evaluate(() => {
      const kept = globalThis as never as {
        __svWidths?: Map<string, number>;
        __svMetrics?: Map<string, unknown>;
        __svSpans?: unknown[];
      };
      return {
        widths: [...(kept.__svWidths ?? new Map())],
        metrics: [...(kept.__svMetrics ?? new Map())],
        spans: kept.__svSpans ?? [],
        faces: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`)
      };
    });
    writeFileSync(`${out}/${c.name}.json`, JSON.stringify({ scene, measured, timing, wall }));
    const ready = (timing as { phase: string; ms: number }[]).find((m) => m.phase === 'ready')?.ms;
    lines.push(`${c.name}\tready ${ready}\twall ${wall}\twidths ${measured.widths.length}`);
    console.log(lines.at(-1));
    await page.close();
  }
  writeFileSync(`${out}/timing.txt`, lines.join('\n') + '\n');
  await browser.close();
  expect(lines.length).toBeGreaterThan(0);
});
