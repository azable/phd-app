// Subsets fonts to Sverlin's character set: Latin, Latin-1, punctuation, arrows, maths, checks.
import subsetFont from 'subset-font';
import { readFileSync, writeFileSync } from 'node:fs';
const ranges = [[0x20, 0x7e], [0xa0, 0xff], [0x2010, 0x2027], [0x2030, 0x205e], [0x2190, 0x21ff], [0x2200, 0x22ff], [0x2713, 0x2713], [0x2717, 0x2717], [0x25a0, 0x25ff]];
const text = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join('');
const out = process.argv[2];
for (const [name, path] of JSON.parse(process.argv[3])) {
  const raw = readFileSync(path);
  for (const format of ['woff2', 'truetype']) {
    const buffer = await subsetFont(raw, text, { targetFormat: format });
    writeFileSync(`${out}/${name}.${format === 'woff2' ? 'woff2' : 'ttf'}`, buffer);
    console.log(name, format, buffer.length, 'from', raw.length);
  }
}
