#!/usr/bin/env node
// Original retained SVG-image workloads and equivalent inline-vector controls.
// Measure the generated directory with images.mjs --inputs DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const NS = 'http://www.w3.org/2000/svg';
const float = n => Number.isInteger(n) ? `${n}.0` : String(n);
export function source() {
  const svg = `<svg xmlns="${NS}" width="8" height="8" viewBox="0 0 8 8"><rect width="4" height="8" fill="red"/><rect x="4" width="4" height="8" fill="blue"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
export function generate(directory) {
  mkdirSync(directory, { recursive: true });
  const url = source();
  for (const [name, count, varied] of [['single', 1, false], ['shared', 16, false], ['viewports', 16, true]]) {
    const embedded = [], inline = [];
    for (let index = 0; index < count; index++) {
      const x = (index % 4) * 32, y = Math.floor(index / 4) * 32, width = varied ? 8 + index : 24, height = 24;
      embedded.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="${url}"/>`);
      inline.push(`<rect x="${x}" y="${y}" width="${float(width / 2)}" height="${height}" fill="red"/><rect x="${float(x + width / 2)}" y="${y}" width="${float(width / 2)}" height="${height}" fill="blue"/>`);
    }
    for (const [kind, children] of [['embedded', embedded], ['inline', inline]]) writeFileSync(join(directory, `${kind}-${name}.svg`), `<svg xmlns="${NS}" width="128" height="128">${children.join('')}</svg>\n`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) console.log('Usage: node modules/bench/nested.mjs OUTPUT_DIRECTORY');
  else if (process.argv.length !== 3) { console.error('Usage: node modules/bench/nested.mjs OUTPUT_DIRECTORY'); process.exitCode = 1; }
  else { try { generate(process.argv[2]); } catch (error) { console.error(`nested: ${error.message}`); process.exitCode = 1; } }
}
