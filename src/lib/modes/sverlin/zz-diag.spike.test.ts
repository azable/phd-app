// Spike: the texts each library measures furthest from the page, by font.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { dejavuFonts, embeddedFonts, harfbuzz, napiCanvas, parseFont, systemFonts } from './zz-measures';

const S = '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
it.skipIf(process.env.SPIKE !== '1')('diagnoses', { timeout: 600_000 }, async () => {
  const page = process.env.SPIKE_PAGE ?? 'system';
  const fonts = process.env.SPIKE_FONTSET === 'embedded' ? embeddedFonts : process.env.SPIKE_FONTSET === 'dejavu' ? dejavuFonts : systemFonts;
  const dir = `${S}/s4/page-${page}`;
  const widths = new Map<string, number>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')))
    for (const [k, w] of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).measured.widths) widths.set(k, w);
  for (const lib of [await harfbuzz(fonts), await napiCanvas(fonts)]) {
    const rows: [number, string, string, number, number][] = [];
    const byFamily: Record<string, number[]> = {};
    for (const [k, w] of widths) {
      const font = k.slice(0, k.indexOf('\n')); const text = k.slice(k.indexOf('\n') + 1);
      const p = parseFont(font);
      if (!lib.covers(text, font)) continue;
      const mine = lib.measure.width(text, font);
      (byFamily[`${p.family}-${p.weight}`] ??= []).push(Math.abs(mine - w));
      rows.push([Math.abs(mine - w), font, text.slice(0, 40), mine, w]);
    }
    rows.sort((a, b) => b[0] - a[0]);
    console.log(lib.name, Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, `n=${v.length} max=${Math.max(...v).toFixed(3)} exact=${v.filter((x) => x === 0).length}`])));
    for (const r of rows.slice(0, 12)) console.log(r[0].toFixed(3), JSON.stringify(r[1]), JSON.stringify(r[2]), r[3].toFixed(3), r[4].toFixed(3));
  }
  expect(1).toBe(1);
});
