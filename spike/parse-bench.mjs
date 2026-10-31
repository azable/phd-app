// Spike: step markup back to the model's tree in Node with htmlparser2, timed on Dijkstra's steps,
// and the size of the geometry a server would send, per presentation, against the 2 MB limit.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseDocument } from 'htmlparser2';
const dir = process.argv[2];
const escape = (t) => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const html = (e) => typeof e === 'string' ? escape(e) : `<${e.tag}${Object.entries(e.attributes).map(([k, v]) => ` ${k}="${v.replaceAll('"', '&quot;')}"`).join('')}${Object.keys(e.style).length ? ` style="${Object.entries(e.style).map(([k, v]) => `${k}:${v}`).join(';')}"` : ''}>${e.children.map(html).join('')}</${e.tag}>`;
const toModel = (node) => node.type === 'text' ? node.data : { tag: node.name, attributes: Object.fromEntries(Object.entries(node.attribs).filter(([k]) => k !== 'style')), style: Object.fromEntries((node.attribs.style ?? '').split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)])), children: node.children.filter((c) => c.type === 'text' || c.type === 'tag').map(toModel) };
const d = JSON.parse(readFileSync(`${dir}/dijkstra-demo.json`, 'utf8'));
const pages = d.scene.dumps.map((dump) => html(dump.tree));
const t = performance.now();
let elements = 0;
for (const page of pages) { const doc = parseDocument(page); const count = (n) => typeof n === 'string' ? 0 : 1 + n.children.reduce((s, c) => s + count(c), 0); elements += count(toModel(doc.children[0])); }
console.log('dijkstra-demo', pages.length, 'steps', (pages.reduce((s, p) => s + p.length, 0) / pages.length / 1024).toFixed(1), 'KB markup/step', ((performance.now() - t) / pages.length).toFixed(3), 'ms parse/step', Math.round(elements / pages.length), 'elements/step');
// Geometry: every node's box and every link's path per step, rounded to 64ths, as JSON.
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const s = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')).scene;
  const r = (v) => Math.round(v * 64) / 64;
  const geometry = s.steps.map((step) => ({ n: step.nodes.map((n) => [n.id, r(n.box.x), r(n.box.y), r(n.box.width), r(n.box.height)]), l: step.links.map((l) => [l.from, l.to, (l.curve ?? l.wire ?? []).flatMap((p) => [r(p.x), r(p.y)])]) }));
  const json = JSON.stringify(geometry);
  const full = JSON.stringify(s.steps);
  rows.push([file.replace('.json', ''), s.steps.length, json.length, gzipSync(json).length, full.length, gzipSync(full).length]);
}
rows.sort((a, b) => b[2] - a[2]);
console.log('presentation steps geometryKB gzipKB fullSceneKB fullSceneGzipKB');
for (const [n, st, a, b, c, e] of rows.slice(0, 6)) console.log(n, st, (a / 1024).toFixed(0), (b / 1024).toFixed(0), (c / 1024).toFixed(0), (e / 1024).toFixed(0));
