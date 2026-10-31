// Spike: each library's cost per text measured, uncached, on every text the pages measured; and
// how much wider or narrower the embedded faces set text than this machine's system faces.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { dejavuFonts, fontkitMeasure, harfbuzz, napiCanvas, opentypeMeasure, parseFont, skiaCanvas } from './zz-measures';

const S = '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
const widthsOf = (page: string) => {
  const widths = new Map<string, number>();
  for (const f of readdirSync(`${S}/s4/page-${page}`).filter((n) => n.endsWith('.json')))
    for (const [k, w] of JSON.parse(readFileSync(`${S}/s4/page-${page}/${f}`, 'utf8')).measured.widths) widths.set(k, w);
  return widths;
};
it.skipIf(process.env.SPIKE !== '1')('speed', { timeout: 600_000 }, async () => {
  const widths = widthsOf(process.env.SPIKE_PAGE ?? 'dejavu');
  const keys = [...widths.keys()].map((k) => [k.slice(0, k.indexOf('\n')), k.slice(k.indexOf('\n') + 1)] as const);
  const out: Record<string, number> = {};
  for (const make of [harfbuzz, napiCanvas, skiaCanvas, fontkitMeasure, opentypeMeasure]) {
    const lib = await make(dejavuFonts);
    let n = 0;
    const started = performance.now();
    for (let round = 0; round < 5; round++)
      for (const [font, text] of keys) {
        // A fresh text each time, so no cache answers.
        const t = `${text}${round}`;
        try { lib.measure.width(t, font); n++; } catch { /* unsupported */ }
      }
    out[lib.name] = (performance.now() - started) / n * 1000;
  }
  // System faces (page-system) against embedded DejaVu (page-dejavu): the same texts, width ratio.
  const system = widthsOf('system');
  const ratios: Record<string, number[]> = {};
  for (const [k, w] of widths) {
    const s = system.get(k);
    if (!s || !w) continue;
    const { family } = parseFont(k.slice(0, k.indexOf('\n')));
    (ratios[family] ??= []).push(w / s);
  }
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const result = { microsecondsPerText: out, dejavuOverSystemWidth: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, { median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length }])) };
  writeFileSync(`${S}/s4/speed.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  expect(1).toBe(1);
});
