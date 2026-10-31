// Spike: Svelte's string renderer inside two sandboxes (isolated-vm, QuickJS), against plain Node,
// rendering a card view about the size of one Dijkstra step (about 130 elements).
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ivm from 'isolated-vm';
import { getQuickJS } from 'quickjs-emscripten';

const source = `<script>let { vertices, step } = $props();</script>
<div class="sv-flow"><h2>Step {step}</h2>{#each vertices as v, k}<div class="sv-node card" data-sv-node={'v' + k}>
<div class="row"><span class="name">{v.name}</span><span class="value">{v.distance === null ? '∞' : v.distance}</span></div>
<div class="row"><span class="label">previous</span><span class="value">{v.previous ?? '∅'}</span></div>
<div class="row"><span class="label">visited</span><span class="value">{v.visited ? '✓' : ''}</span></div>
{#each v.edges as e}<div class="edge" data-to={e.to}><span>{e.to}</span><span>{e.weight}</span></div>{/each}</div>{/each}</div>`;
const component = compile(source, { filename: 'Card.svelte', generate: 'server' }).js.code;
const svelteDir = dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
const entry = `import { render } from 'svelte/server'; import Card from 'virtual:card';
globalThis.renderStep = (json) => render(Card, { props: JSON.parse(json) }).body;`;
const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
  bundle: true, write: false, format: 'iife', platform: 'neutral', mainFields: ['module', 'main'],
  conditions: ['svelte'], minify: true,
  plugins: [{ name: 'v', setup(b) {
    b.onResolve({ filter: /^virtual:card$/ }, () => ({ path: 'card', namespace: 'v' }));
    b.onResolve({ filter: /^svelte\/server$/ }, () => ({ path: join(svelteDir, 'src/server/index.js') }));
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'crypto', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}; export const randomUUID = () => "x";', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: component, loader: 'js', resolveDir: svelteDir }));
  } }]
});
const code = result.outputFiles[0].text;
console.log('bundle bytes', code.length);
const states = Array.from({ length: 155 }, (_, step) => JSON.stringify({ step, vertices: 'ABCDE'.split('').map((name, k) => ({ name, distance: step > k ? k * 3 : null, previous: step > k ? 'A' : null, visited: step > k * 2, edges: [{ to: 'B', weight: 4 }, { to: 'C', weight: 2 }, { to: 'D', weight: 7 }] })) }));
const time = (label, run) => { const t = performance.now(); let html; for (const s of states) html = run(s); console.log(label, ((performance.now() - t) / states.length).toFixed(3), 'ms/state', html.length, 'chars'); return html; };
// Plain Node, no sandbox.
const node = new Function(`${code}; return globalThis.renderStep;`)();
const reference = time('node (no sandbox)', node);
// isolated-vm: a V8 isolate with no Node APIs, a memory limit, and a time limit per call.
const isolate = new ivm.Isolate({ memoryLimit: 64 });
const context = isolate.createContextSync();
context.global.setSync('globalThis', context.global.derefInto());
isolate.compileScriptSync(code).runSync(context, { timeout: 2000 });
const render = context.global.getSync('renderStep', { reference: true });
const startIvm = performance.now();
const html = time('isolated-vm', (s) => render.applySync(undefined, [s], { timeout: 1000 }));
console.log('isolated-vm setup+run identical:', html === reference, ((performance.now() - startIvm)).toFixed(0), 'ms');
// QuickJS compiled to WebAssembly.
const quickjs = await getQuickJS();
const vm = quickjs.newContext();
vm.runtime.setMemoryLimit(64 * 1024 * 1024);
vm.unwrapResult(vm.evalCode(code)).dispose();
const fn = vm.getProp(vm.global, 'renderStep');
const qjs = time('quickjs-emscripten', (s) => { const arg = vm.newString(s); const out = vm.unwrapResult(vm.callFunction(fn, vm.undefined, arg)); arg.dispose(); const text = vm.getString(out); out.dispose(); return text; });
console.log('quickjs identical:', qjs === reference);
// An infinite loop in a view is stopped by the time limit, not hanging the server.
try { isolate.compileScriptSync('for(;;){}').runSync(context, { timeout: 200 }); } catch (e) { console.log('isolated-vm loop:', e.message); }
try { context.evalSync('typeof process + " " + typeof require'); console.log('isolate sees', context.evalSync('typeof process + " " + typeof require')); } catch (e) { console.log(e.message); }
